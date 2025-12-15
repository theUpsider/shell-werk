package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"runtime"
	"strings"
	"time"

	"shell-werk/internal/tools"
)

const braveSearchEndpointDefault = "https://api.search.brave.com/res/v1/web/search"

type dialogueLoop struct {
	provider     string
	endpoint     string
	apiKey       string
	model        string
	tools        []string
	toolDefs     []tools.ToolDefinition
	client       *http.Client
	sink         StreamEventSink
	sessionID    string
	promptLoader *SystemPromptLoader
	toolExecutor ToolExecutor
	prompter     ContinuationPrompter
	iterationLimit int
	failureLimit   int
	completionRequester completionRequester
}

type DialogueDependencies struct {
	Client       *http.Client
	PromptLoader *SystemPromptLoader
	ToolExecutor ToolExecutor
	ContinuationPrompter ContinuationPrompter
}

type completionRequester func(ctx context.Context, messages []chatCompletionMessage, tools []tools.ToolDefinition) (completionChoice, error)

func NewDialogueLoop(req ChatRequest, sink StreamEventSink, deps DialogueDependencies) *dialogueLoop {
	client := deps.Client
	if client == nil {
		client = MakeClient()
	}

	promptLoader := deps.PromptLoader
	if promptLoader == nil {
		promptLoader = DefaultSystemPromptLoader()
	}

	toolExecutor := deps.ToolExecutor
	if toolExecutor == nil {
		toolExecutor = NewToolExecutor(ToolExecutorConfig{
			Client:            client,
			WebSearchAPIKey:   req.WebSearchAPIKey,
			WebSearchEndpoint: req.WebSearchEndpoint,
		})
	}
	prompter := deps.ContinuationPrompter
	if prompter == nil {
		prompter = autoContinuePrompter{}
	}

	loop := &dialogueLoop{
		provider:     strings.ToLower(req.Provider),
		endpoint:     req.Endpoint,
		apiKey:       req.APIKey,
		model:        req.Model,
		tools:        req.Tools,
		toolDefs:     req.ToolDefs,
		client:       client,
		sink:         sink,
		sessionID:    strings.TrimSpace(req.SessionID),
		promptLoader: promptLoader,
		toolExecutor: toolExecutor,
		prompter:     prompter,
		iterationLimit: 30,
		failureLimit:   5,
	}
	loop.completionRequester = loop.requestCompletion

	return loop
}

func (l *dialogueLoop) Run(ctx context.Context, req ChatRequest) (ChatMessage, []DialogueTrace, error) {
	trace := []DialogueTrace{}
	start := time.Now()
	failures := map[string]int{}

	toolDefs := l.toolDefs

	systemPrompt, promptErr := l.promptLoader.Load(runtime.GOOS)
	if promptErr != nil {
		err := fmt.Errorf("load system prompt: %w", promptErr)
		trace = append(trace, DialogueTrace{
			ID:        newTraceID(),
			Role:      "assistant",
			Kind:      "error",
			Status:    "failed",
			Content:   err.Error(),
			CreatedAt: time.Now(),
		})
		return ChatMessage{Role: "assistant", Content: err.Error()}, trace, err
	}

	messages := []chatCompletionMessage{
		{Role: "system", Content: systemPrompt},
	}

	for _, msg := range ConversationFromRequest(req) {
		messages = append(messages, chatCompletionMessage{Role: msg.Role, Content: msg.Content})
	}

	iterationLimit := l.iterationLimit
	failureLimit := l.failureLimit

	for iteration := 0; ; iteration++ {
		if iteration >= iterationLimit {
			prompt := fmt.Sprintf("Reached %d tool iterations. Continue?", iteration)
			continueLoop, err := l.handleContinuation(ctx, &trace, ContinuationRequest{
				Reason:    "iteration_limit",
				Iteration: iteration,
				Limit:     iterationLimit,
			}, prompt)
			if err != nil {
				return ChatMessage{Role: "assistant", Content: fmt.Sprintf("Stopped while waiting for approval: %s", err.Error())}, trace, err
			}
			if !continueLoop {
				stop := fmt.Sprintf("Stopped after %d tool iterations at your request.", iteration)
				trace = append(trace, DialogueTrace{
					ID:        newTraceID(),
					Role:      "assistant",
					Kind:      "final",
					Status:    "cancelled",
					Content:   stop,
					CreatedAt: time.Now(),
				})
				return ChatMessage{Role: "assistant", Content: stop}, trace, nil
			}
			iterationLimit += 10
		}

		choice, err := l.completionRequester(ctx, messages, toolDefs)
		if err != nil {
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "assistant",
				Kind:      "error",
				Status:    "failed",
				Content:   err.Error(),
				CreatedAt: time.Now(),
			})
			return ChatMessage{Role: "assistant", Content: fmt.Sprintf("Dialog failed: %s", err.Error())}, trace, err
		}

		assistantMsg := chatCompletionMessage{
			Role:      choice.Message.Role,
			Content:   choice.Message.Content,
			ToolCalls: choice.Message.ToolCalls,
		}
		messages = append(messages, assistantMsg)

		if len(choice.Message.ToolCalls) == 0 {
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "assistant",
				Kind:      "final",
				Status:    "complete",
				Content:   assistantMsg.Content,
				CreatedAt: time.Now(),
			})
			return ChatMessage{Role: assistantMsg.Role, Content: assistantMsg.Content}, trace, nil
		}

		if len(choice.Message.ToolCalls) > 0 {
			l.emitThinkingf("%s", assistantMsg.Content)
		}

		for _, tc := range choice.Message.ToolCalls {
			argsMap, parseErr := parseArguments(tc.Function.Arguments)
			callPreview := truncate(tc.Function.Arguments, 200)
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "tool",
				Kind:      "tool_call",
				Title:     tc.Function.Name,
				Status:    "running",
				Content:   fmt.Sprintf("Calling %s with %s", tc.Function.Name, truncate(tc.Function.Arguments, 320)),
				CreatedAt: time.Now(),
			})
			if callPreview != "" {
				l.emitThinkingf("Running %s (%s)", tc.Function.Name, callPreview)
			} else {
				l.emitThinkingf("Running %s", tc.Function.Name)
			}

			if tc.Function.Name == "request_fullfilled" {
				summary := contentFromRequestFulfilled(argsMap, assistantMsg.Content)
				trace = append(trace, DialogueTrace{
					ID:        newTraceID(),
					Role:      "assistant",
					Kind:      "final",
					Status:    "complete",
					Content:   summary,
					CreatedAt: time.Now(),
				})
				return ChatMessage{Role: "assistant", Content: summary}, trace, nil
			}

			if parseErr != nil {
				trace = append(trace, DialogueTrace{
					ID:        newTraceID(),
					Role:      "tool",
					Kind:      "tool_result",
					Title:     tc.Function.Name,
					Status:    "error",
					Content:   fmt.Sprintf("invalid arguments: %v", parseErr),
					CreatedAt: time.Now(),
				})
				l.emitThinkingf("%s failed: invalid arguments", tc.Function.Name)
				continue
			}

			result, status := l.toolExecutor.Execute(ctx, tc.Function.Name, argsMap)
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "tool",
				Kind:      "tool_result",
				Title:     tc.Function.Name,
				Status:    status,
				Content:   result,
				CreatedAt: time.Now(),
			})
			l.emitThinkingf("%s %s", tc.Function.Name, status)

			if status == "error" {
				key := fmt.Sprintf("%s|%s", tc.Function.Name, tc.Function.Arguments)
				failures[key]++
				if failures[key] >= failureLimit {
					prompt := fmt.Sprintf("The %s tool failed %d times. Continue?", tc.Function.Name, failures[key])
					continueLoop, err := l.handleContinuation(ctx, &trace, ContinuationRequest{
						Reason:       "tool_failures",
						FailureCount: failures[key],
						FailureLimit: failureLimit,
						ToolName:     tc.Function.Name,
						Detail:       result,
					}, prompt)
					if err != nil {
						return ChatMessage{Role: "assistant", Content: fmt.Sprintf("Stopped while waiting for approval: %s", err.Error())}, trace, err
					}
					if !continueLoop {
						stop := fmt.Sprintf("Stopped after repeated %s tool failures at your request.", tc.Function.Name)
						trace = append(trace, DialogueTrace{
							ID:        newTraceID(),
							Role:      "assistant",
							Kind:      "final",
							Status:    "cancelled",
							Content:   stop,
							CreatedAt: time.Now(),
						})
						return ChatMessage{Role: "assistant", Content: stop}, trace, nil
					}
					failures[key] = 0
					failureLimit += 2
				}
			}

			messages = append(messages, chatCompletionMessage{
				Role:       "tool",
				Name:       tc.Function.Name,
				Content:    result,
				ToolCallID: tc.ID,
			})
		}
	}

	trace = append(trace, DialogueTrace{
		ID:        newTraceID(),
		Role:      "assistant",
		Kind:      "timeout",
		Status:    "timeout",
		Content:   "Loop ended without completion signal.",
		CreatedAt: time.Now(),
	})

	elapsed := time.Since(start).Round(time.Second)
	return ChatMessage{Role: "assistant", Content: fmt.Sprintf("Request stopped after %s without completion.", elapsed)}, trace, errors.New("dialogue loop ended without completion")
}

func (l *dialogueLoop) requestCompletion(ctx context.Context, messages []chatCompletionMessage, tools []tools.ToolDefinition) (completionChoice, error) {
	payload := completionRequest{
		Model:       l.model,
		Messages:    messages,
		Stream:      false,
		Tools:       tools,
		Temperature: 0,
	}

	// Avoid sending tool_choice when no tools are available; vLLM rejects that with 400.
	if len(tools) > 0 {
		payload.ToolChoice = "auto"
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return completionChoice{}, err
	}

	url := l.completionsURL()
	log.Printf("[%s] Sending dialogue completion request to %s with model %s", time.Now().Format(time.RFC3339), url, l.model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return completionChoice{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(l.apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+l.apiKey)
	}

	resp, err := l.client.Do(req)
	if err != nil {
		return completionChoice{}, fmt.Errorf("%s completion request failed: %w", strings.ToUpper(l.provider), err)
	}
	defer resp.Body.Close()
	log.Printf("[%s] Received dialogue completion response", time.Now().Format(time.RFC3339))

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return completionChoice{}, fmt.Errorf("%s completion read failed: %w", strings.ToUpper(l.provider), err)
	}

	if resp.StatusCode >= http.StatusBadRequest {
		detail := strings.TrimSpace(string(rawBody))
		if detail == "" {
			detail = resp.Status
		}
		return completionChoice{}, fmt.Errorf("%s completion returned %s: %s", strings.ToUpper(l.provider), resp.Status, truncate(detail, 512))
	}

	if l.provider == "ollama" {
		choice, err := decodeOllamaCompletion(rawBody)
		if err != nil {
			return completionChoice{}, fmt.Errorf("%s completion decode failed: %w", strings.ToUpper(l.provider), err)
		}
		return choice, nil
	}

	var decoded completionResponse
	if err := json.Unmarshal(rawBody, &decoded); err != nil {
		return completionChoice{}, fmt.Errorf("%s completion decode failed: %w", strings.ToUpper(l.provider), err)
	}

	if decoded.Error.Message != "" {
		return completionChoice{}, fmt.Errorf("%s completion error: %s", strings.ToUpper(l.provider), decoded.Error.Message)
	}
	if len(decoded.Choices) == 0 {
		return completionChoice{}, errors.New("no choices returned from provider")
	}

	return decoded.Choices[0], nil
}

func (l *dialogueLoop) completionsURL() string {
	base := NormalizeBase(l.endpoint)
	switch l.provider {
	case "ollama":
		return base + "/api/chat"
	default:
		return base + "/v1/chat/completions"
	}
}

func decodeOllamaCompletion(body []byte) (completionChoice, error) {
	var decoded ollamaResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return completionChoice{}, err
	}

	if strings.TrimSpace(decoded.Error) != "" {
		return completionChoice{}, errors.New(strings.TrimSpace(decoded.Error))
	}

	choice := completionChoice{}
	choice.Message.Role = decoded.Message.Role
	if strings.TrimSpace(choice.Message.Role) == "" {
		choice.Message.Role = "assistant"
	}
	choice.Message.Content = decoded.Message.Content
	choice.Message.ToolCalls = convertOllamaChatToolCalls(decoded.Message.ToolCalls)

	return choice, nil
}

func convertOllamaChatToolCalls(calls []ollamaToolCall) []chatToolCall {
	if len(calls) == 0 {
		return nil
	}

	out := make([]chatToolCall, 0, len(calls))
	for _, tc := range calls {
		args := "{}"
		if data, err := json.Marshal(tc.Function.Arguments); err == nil {
			args = string(data)
		}
		out = append(out, chatToolCall{
			Type: "function",
			Function: toolCallFunction{
				Name:      tc.Function.Name,
				Arguments: args,
			},
		})
	}
	return out
}

func (l *dialogueLoop) handleContinuation(ctx context.Context, trace *[]DialogueTrace, req ContinuationRequest, prompt string) (bool, error) {
	if l.prompter == nil {
		return true, nil
	}

	if strings.TrimSpace(prompt) != "" {
		l.emitThinkingf("%s", prompt)
	}

	if trace != nil {
		*trace = append(*trace, DialogueTrace{
			ID:        newTraceID(),
			Role:      "assistant",
			Kind:      "continuation",
			Title:     "Approval required",
			Status:    "pending",
			Content:   prompt,
			CreatedAt: time.Now(),
		})
	}

	decision, err := l.prompter.RequestContinuation(ctx, l.sessionID, req)
	if err != nil {
		return false, err
	}

	if trace != nil {
		status := "continued"
		message := "User approved continuing generation."
		if decision == ContinuationDecisionCancel {
			status = "cancelled"
			message = "User stopped generation."
		}
		*trace = append(*trace, DialogueTrace{
			ID:        newTraceID(),
			Role:      "assistant",
			Kind:      "continuation",
			Title:     "Approval resolved",
			Status:    status,
			Content:   message,
			CreatedAt: time.Now(),
		})
	}

	return decision == ContinuationDecisionContinue, nil
}

func (l *dialogueLoop) emitThinkingf(format string, args ...any) {
	if l.sink == nil || l.sessionID == "" {
		return
	}

	chunk := strings.TrimSpace(fmt.Sprintf(format, args...))
	if chunk == "" {
		return
	}

	chunk = truncate(chunk, 512) + "\n"

	l.sink.ThinkingUpdate(l.sessionID, chunk)
}
