package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
)

type StreamEventSink interface {
	ThinkingStart(sessionID string)
	ThinkingUpdate(sessionID, chunk string)
	ThinkingEnd(sessionID string)
	AnswerUpdate(sessionID, chunk string)
}

// Streamer handles streaming chat responses and pushes events to the UI sink.
type Streamer struct {
	sink StreamEventSink
}

func NewStreamer(sink StreamEventSink) *Streamer {
	return &Streamer{sink: sink}
}

func (s *Streamer) StreamChat(ctx context.Context, req ChatRequest) (ChatMessage, error) {
	provider := strings.ToLower(req.Provider)
	if provider == "mock" {
		return MockProvider{}.Chat(ctx, req)
	}

	url := streamURL(provider, NormalizeBase(req.Endpoint))
	if url == "" {
		return ChatMessage{}, fmt.Errorf("unsupported provider for streaming: %s", provider)
	}

	payload := map[string]any{
		"model":    req.Model,
		"messages": convertHistory(req.History),
		"stream":   true,
	}
	if len(req.ToolDefs) > 0 {
		payload["tools"] = req.ToolDefs
	}
	if provider == "vllm" && len(req.ToolDefs) > 0 {
		payload["tool_choice"] = "auto"
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return ChatMessage{}, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return ChatMessage{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if provider == "vllm" && strings.TrimSpace(req.APIKey) != "" {
		httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
	}

	client := MakeClient()
	resp, err := client.Do(httpReq)
	if err != nil {
		return ChatMessage{}, fmt.Errorf("stream request to %s failed: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4_096))
		detail := strings.TrimSpace(string(body))
		if detail == "" {
			detail = resp.Status
		}
		return ChatMessage{}, fmt.Errorf("streaming request failed (%s): %s", resp.Status, truncate(detail, 512))
	}

	reader := bufio.NewReader(resp.Body)
	final := &strings.Builder{}
	var role string
	var toolCalls []ToolCall
	state := streamingState{sink: s.sink, sessionID: req.SessionID, final: final}

	if err := s.consumeStream(reader, &state, &role, &toolCalls); err != nil && !errors.Is(err, errStreamDone) {
		return ChatMessage{}, err
	}

	if role == "" {
		role = "assistant"
	}

	return ChatMessage{Role: role, Content: final.String(), ToolCalls: toolCalls}, nil
}

func streamURL(provider, base string) string {
	switch provider {
	case "ollama":
		return base + "/api/chat"
	case "vllm":
		return base + "/v1/chat/completions"
	default:
		return ""
	}
}

func convertHistory(history []ChatMessage) []chatCompletionMessage {
	messages := make([]chatCompletionMessage, 0, len(history))
	for _, msg := range history {
		if strings.TrimSpace(msg.Content) == "" {
			continue
		}
		messages = append(messages, chatCompletionMessage{Role: msg.Role, Content: msg.Content})
	}
	return messages
}

func extractRole(choice streamingChoice) string {
	if choice.Delta.Role != "" {
		return choice.Delta.Role
	}
	if choice.Message.Role != "" {
		return choice.Message.Role
	}
	return ""
}

func convertChatToolCalls(calls []chatToolCall) []ToolCall {
	if len(calls) == 0 {
		return nil
	}
	out := make([]ToolCall, 0, len(calls))
	for _, tc := range calls {
		out = append(out, ToolCall{
			ID:   tc.ID,
			Type: tc.Type,
			Function: ToolCallFunction{
				Name:      tc.Function.Name,
				Arguments: tc.Function.Arguments,
			},
		})
	}
	return out
}

func convertOllamaToolCalls(calls []ollamaStreamToolCall) []chatToolCall {
	if len(calls) == 0 {
		return nil
	}
	out := make([]chatToolCall, 0, len(calls))
	for _, tc := range calls {
		args := "{}"
		if data, err := json.Marshal(tc.Function.Arguments); err == nil {
			args = string(data)
		}
		typeName := tc.Type
		if strings.TrimSpace(typeName) == "" {
			typeName = "function"
		}
		out = append(out, chatToolCall{
			ID:   tc.ID,
			Type: typeName,
			Function: toolCallFunction{
				Name:      tc.Function.Name,
				Arguments: args,
			},
		})
	}
	return out
}

func (s *Streamer) processStreamLine(raw string, state *streamingState, role *string, toolCalls *[]ToolCall) error {
	chunk := strings.TrimSpace(raw)
	if strings.EqualFold(chunk, "[DONE]") || strings.EqualFold(chunk, "data: [DONE]") {
		return errStreamDone
	}
	if strings.HasPrefix(chunk, "data:") {
		chunk = strings.TrimSpace(strings.TrimPrefix(chunk, "data:"))
	}
	if strings.EqualFold(chunk, "[DONE]") {
		return errStreamDone
	}

	if handled, err := s.tryOpenAIChunk(chunk, state, role, toolCalls); handled {
		return err
	}
	if handled, err := s.tryOllamaChunk(chunk, state, role, toolCalls); handled {
		return err
	}

	log.Printf("unrecognized stream chunk: %s", chunk)
	return nil
}

func (s *Streamer) tryOpenAIChunk(chunk string, state *streamingState, role *string, toolCalls *[]ToolCall) (bool, error) {
	var openai streamingChunk
	if err := json.Unmarshal([]byte(chunk), &openai); err != nil {
		return false, nil
	}
	if openai.Error.Message != "" {
		return true, fmt.Errorf(openai.Error.Message)
	}
	if len(openai.Choices) == 0 {
		return false, nil
	}
	s.applyStreamingChoices(openai.Choices, state, role, toolCalls)
	return true, nil
}

func (s *Streamer) tryOllamaChunk(chunk string, state *streamingState, role *string, toolCalls *[]ToolCall) (bool, error) {
	var ollama ollamaStreamChunk
	if err := json.Unmarshal([]byte(chunk), &ollama); err != nil {
		return false, nil
	}
	if strings.TrimSpace(ollama.Error) != "" {
		return true, fmt.Errorf(ollama.Error)
	}

	if strings.TrimSpace(ollama.Message.Thinking) != "" {
		state.emitThinking(ollama.Message.Thinking)
		if ollama.Message.Content == "" && len(ollama.Message.ToolCalls) == 0 && !ollama.Done {
			return true, nil
		}
	}

	if ollama.Message.Content != "" || len(ollama.Message.ToolCalls) > 0 {
		converted := convertOllamaToolCalls(ollama.Message.ToolCalls)
		choice := streamingChoice{
			Delta: streamingDelta{
				Role:      ollama.Message.Role,
				Content:   ollama.Message.Content,
				ToolCalls: converted,
			},
			Message: streamingMessage{
				Role:      ollama.Message.Role,
				Content:   ollama.Message.Content,
				ToolCalls: converted,
			},
		}
		s.applyStreamingChoices([]streamingChoice{choice}, state, role, toolCalls)
	}

	if ollama.Done {
		return true, errStreamDone
	}
	if ollama.Message.Content == "" && len(ollama.Message.ToolCalls) == 0 {
		return false, nil
	}
	return true, nil
}

func (s *Streamer) applyStreamingChoices(choices []streamingChoice, state *streamingState, role *string, toolCalls *[]ToolCall) {
	for _, choice := range choices {
		if *role == "" {
			*role = extractRole(choice)
		}
		*toolCalls = append(*toolCalls, convertChatToolCalls(choice.Delta.ToolCalls)...)
		*toolCalls = append(*toolCalls, convertChatToolCalls(choice.Message.ToolCalls)...)

		content := choice.Delta.Content
		if content == "" {
			content = choice.Message.Content
		}
		if content == "" {
			continue
		}
		state.consume(content)
	}
}

func (s *Streamer) consumeStream(reader *bufio.Reader, state *streamingState, role *string, toolCalls *[]ToolCall) error {
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if errors.Is(err, io.EOF) {
				return errStreamDone
			}
			return err
		}

		chunk := strings.TrimSpace(line)
		if chunk == "" {
			continue
		}
		if err := s.processStreamLine(chunk, state, role, toolCalls); err != nil {
			if errors.Is(err, errStreamDone) {
				return errStreamDone
			}
			return err
		}
	}
}
