package main

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

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	thinkingStartEvent  = "thinking:start"
	thinkingUpdateEvent = "thinking:update"
	thinkingEndEvent    = "thinking:end"
	answerUpdateEvent   = "answer:update"
)

var errStreamDone = errors.New("stream done")

type thinkingEvent struct {
	SessionID string `json:"sessionId"`
	Chunk     string `json:"chunk,omitempty"`
}

type answerEvent struct {
	SessionID string `json:"sessionId"`
	Chunk     string `json:"chunk"`
}

func (a *App) emitEvent(name string, payload any) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, name, payload)
}

func (a *App) emitThinkingStart(sessionID string) {
	a.emitEvent(thinkingStartEvent, thinkingEvent{SessionID: sessionID})
}

func (a *App) emitThinkingUpdate(sessionID, chunk string) {
	if strings.TrimSpace(chunk) == "" {
		return
	}
	a.emitEvent(thinkingUpdateEvent, thinkingEvent{SessionID: sessionID, Chunk: chunk})
}

func (a *App) emitThinkingEnd(sessionID string) {
	a.emitEvent(thinkingEndEvent, thinkingEvent{SessionID: sessionID})
}

func (a *App) emitAnswerUpdate(sessionID, chunk string) {
	if chunk == "" {
		return
	}
	a.emitEvent(answerUpdateEvent, answerEvent{SessionID: sessionID, Chunk: chunk})
}

func (a *App) streamChat(ctx context.Context, req ChatRequest) (ChatMessage, error) {
	provider := strings.ToLower(req.Provider)
	if provider == "mock" {
		return MockProvider{}.Chat(ctx, req)
	}

	url := streamURL(provider, normalizeBase(req.Endpoint))
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

	client := makeClient()
	resp, err := client.Do(httpReq)
	if err != nil {
		return ChatMessage{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(resp.Body)
		return ChatMessage{}, fmt.Errorf("streaming request failed: %s", strings.TrimSpace(string(body)))
	}

	reader := bufio.NewReader(resp.Body)
	final := &strings.Builder{}
	var role string
	var toolCalls []ToolCall
	state := streamingState{app: a, sessionID: req.SessionID, final: final}

	if err := a.consumeStream(reader, &state, &role, &toolCalls); err != nil && !errors.Is(err, errStreamDone) {
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

func (a *App) processStreamLine(raw string, state *streamingState, role *string, toolCalls *[]ToolCall) error {
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

	if handled, err := a.tryOpenAIChunk(chunk, state, role, toolCalls); handled {
		return err
	}
	if handled, err := a.tryOllamaChunk(chunk, state, role, toolCalls); handled {
		return err
	}

	log.Printf("unrecognized stream chunk: %s", chunk)
	return nil
}

func (a *App) tryOpenAIChunk(chunk string, state *streamingState, role *string, toolCalls *[]ToolCall) (bool, error) {
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
	a.applyStreamingChoices(openai.Choices, state, role, toolCalls)
	return true, nil
}

func (a *App) tryOllamaChunk(chunk string, state *streamingState, role *string, toolCalls *[]ToolCall) (bool, error) {
	var ollama ollamaStreamChunk
	if err := json.Unmarshal([]byte(chunk), &ollama); err != nil {
		return false, nil
	}
	if strings.TrimSpace(ollama.Error) != "" {
		return true, fmt.Errorf(ollama.Error)
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
		a.applyStreamingChoices([]streamingChoice{choice}, state, role, toolCalls)
	}

	if ollama.Done {
		return true, errStreamDone
	}
	if ollama.Message.Content == "" && len(ollama.Message.ToolCalls) == 0 {
		return false, nil
	}
	return true, nil
}

func (a *App) applyStreamingChoices(choices []streamingChoice, state *streamingState, role *string, toolCalls *[]ToolCall) {
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

func (a *App) consumeStream(reader *bufio.Reader, state *streamingState, role *string, toolCalls *[]ToolCall) error {
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
		if err := a.processStreamLine(chunk, state, role, toolCalls); err != nil {
			if errors.Is(err, errStreamDone) {
				return errStreamDone
			}
			return err
		}
	}
}

type streamingChunk struct {
	Choices []streamingChoice `json:"choices"`
	Error   struct {
		Message string `json:"message"`
	} `json:"error"`
}

type ollamaStreamChunk struct {
	Model   string              `json:"model"`
	Message ollamaStreamMessage `json:"message"`
	Done    bool                `json:"done"`
	Error   string              `json:"error"`
}

type ollamaStreamMessage struct {
	Role      string                 `json:"role"`
	Content   string                 `json:"content"`
	ToolCalls []ollamaStreamToolCall `json:"tool_calls,omitempty"`
}

type ollamaStreamToolCall struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	} `json:"function"`
}

type streamingChoice struct {
	Delta   streamingDelta   `json:"delta"`
	Message streamingMessage `json:"message"`
}

type streamingDelta struct {
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	ToolCalls []chatToolCall `json:"tool_calls,omitempty"`
}

type streamingMessage struct {
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	ToolCalls []chatToolCall `json:"tool_calls,omitempty"`
}

type streamingState struct {
	app        *App
	sessionID  string
	final      *strings.Builder
	inThinking bool
}

func (s *streamingState) consume(content string) {
	if content == "" {
		return
	}
	lower := strings.ToLower(content)
	pos := 0
	startTag := "<think>"
	endTag := "</think>"

	for pos < len(content) {
		if s.inThinking {
			remaining := lower[pos:]
			endIdx := strings.Index(remaining, endTag)
			if endIdx == -1 {
				s.emitThinking(content[pos:])
				return
			}
			s.emitThinking(content[pos : pos+endIdx])
			s.inThinking = false
			s.app.emitThinkingEnd(s.sessionID)
			pos += endIdx + len(endTag)
			continue
		}

		remaining := lower[pos:]
		startIdx := strings.Index(remaining, startTag)
		if startIdx == -1 {
			s.emitAnswer(content[pos:])
			return
		}
		if startIdx > 0 {
			s.emitAnswer(content[pos : pos+startIdx])
		}
		pos += startIdx + len(startTag)
		s.inThinking = true
	}
}

func (s *streamingState) emitAnswer(chunk string) {
	if chunk == "" {
		return
	}
	s.final.WriteString(chunk)
	s.app.emitAnswerUpdate(s.sessionID, chunk)
}

func (s *streamingState) emitThinking(chunk string) {
	if chunk == "" {
		return
	}
	s.app.emitThinkingUpdate(s.sessionID, chunk)
}
