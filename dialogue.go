package main

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
)

// DialogueTrace captures intermediate steps in the dialogue feedback loop so the
// frontend can render partial tool progress. Each entry is ordered chronologically.
type DialogueTrace struct {
	ID        string    `json:"id"`
	Role      string    `json:"role"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title,omitempty"`
	Content   string    `json:"content"`
	Status    string    `json:"status,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type dialogueLoop struct {
	provider string
	endpoint string
	apiKey   string
	model    string
	tools    []string
	toolDefs []ToolDefinition
	client   *http.Client
}

type toolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type chatToolCall struct {
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function toolCallFunction `json:"function"`
}

type chatCompletionMessage struct {
	Role       string         `json:"role"`
	Content    string         `json:"content,omitempty"`
	ToolCalls  []chatToolCall `json:"tool_calls,omitempty"`
	Name       string         `json:"name,omitempty"`
	ToolCallID string         `json:"tool_call_id,omitempty"`
}

type completionRequest struct {
	Model       string                  `json:"model"`
	Messages    []chatCompletionMessage `json:"messages"`
	Stream      bool                    `json:"stream"`
	Tools       []ToolDefinition        `json:"tools,omitempty"`
	ToolChoice  string                  `json:"tool_choice,omitempty"`
	Temperature float32                 `json:"temperature,omitempty"`
}

type completionChoice struct {
	Message struct {
		Role      string         `json:"role"`
		Content   string         `json:"content"`
		ToolCalls []chatToolCall `json:"tool_calls,omitempty"`
	} `json:"message"`
	FinishReason string `json:"finish_reason"`
}

type completionResponse struct {
	Choices []completionChoice `json:"choices"`
	Error   struct {
		Message string `json:"message"`
	} `json:"error"`
}

func newDialogueLoop(req ChatRequest) *dialogueLoop {
	return &dialogueLoop{
		provider: strings.ToLower(req.Provider),
		endpoint: req.Endpoint,
		apiKey:   req.APIKey,
		model:    req.Model,
		tools:    req.Tools,
		toolDefs: req.ToolDefs,
		client:   makeClient(),
	}
}

func (l *dialogueLoop) run(ctx context.Context, req ChatRequest) (ChatMessage, []DialogueTrace, error) {
	trace := []DialogueTrace{}
	start := time.Now()

	toolDefs := l.toolDefs
	messages := []chatCompletionMessage{
		{Role: "system", Content: l.systemPrompt()},
	}

	for _, msg := range conversationFromRequest(req) {
		messages = append(messages, chatCompletionMessage{Role: msg.Role, Content: msg.Content})
	}

	// Allow up to six tool iterations per request to avoid runaway loops.
	for iteration := 0; iteration < 6; iteration++ {
		choice, err := l.requestCompletion(ctx, messages, toolDefs)
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

		for _, tc := range choice.Message.ToolCalls {
			argsMap, parseErr := parseArguments(tc.Function.Arguments)
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "tool",
				Kind:      "tool_call",
				Title:     tc.Function.Name,
				Status:    "running",
				Content:   fmt.Sprintf("Calling %s with %s", tc.Function.Name, truncate(tc.Function.Arguments, 320)),
				CreatedAt: time.Now(),
			})

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
				continue
			}

			result, status := l.executeTool(ctx, tc.Function.Name, argsMap)
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "tool",
				Kind:      "tool_result",
				Title:     tc.Function.Name,
				Status:    status,
				Content:   result,
				CreatedAt: time.Now(),
			})

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
		Content:   "Loop ended after 6 iterations without request_fullfilled.",
		CreatedAt: time.Now(),
	})

	elapsed := time.Since(start).Round(time.Second)
	return ChatMessage{Role: "assistant", Content: fmt.Sprintf("Request stopped after %s without completion.", elapsed)}, trace, errors.New("dialogue loop exceeded iteration limit")
}

func (l *dialogueLoop) requestCompletion(ctx context.Context, messages []chatCompletionMessage, tools []ToolDefinition) (completionChoice, error) {
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
		return completionChoice{}, err
	}
	defer resp.Body.Close()
	log.Printf("[%s] Received dialogue completion response", time.Now().Format(time.RFC3339))

	var decoded completionResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return completionChoice{}, err
	}

	if decoded.Error.Message != "" {
		return completionChoice{}, errors.New(decoded.Error.Message)
	}
	if len(decoded.Choices) == 0 {
		return completionChoice{}, errors.New("no choices returned from provider")
	}

	return decoded.Choices[0], nil
}

func (l *dialogueLoop) executeTool(ctx context.Context, name string, args map[string]any) (string, string) {
	switch name {
	case "browser":
		return l.browserTool(ctx, args)
	case "shell":
		return l.shellTool(ctx, args)
	default:
		return fmt.Sprintf("tool %s is not implemented", name), "error"
	}
}

func (l *dialogueLoop) browserTool(ctx context.Context, args map[string]any) (string, string) {
	rawURL, _ := args["url"].(string)
	if strings.TrimSpace(rawURL) == "" {
		return "missing url argument", "error"
	}

	maxBytes := 2_048
	if val, ok := args["maxBytes"].(float64); ok && val > 256 {
		maxBytes = int(val)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return fmt.Sprintf("request build failed: %v", err), "error"
	}

	resp, err := l.client.Do(req)
	if err != nil {
		return fmt.Sprintf("request failed: %v", err), "error"
	}
	defer resp.Body.Close()

	limited := io.LimitedReader{R: resp.Body, N: int64(maxBytes)}
	buf, err := io.ReadAll(&limited)
	if err != nil {
		return fmt.Sprintf("read failed: %v", err), "error"
	}

	preview := strings.TrimSpace(string(buf))
	if preview == "" {
		preview = fmt.Sprintf("(%s returned no body)", rawURL)
	}
	return truncate(preview, maxBytes), "done"
}

func (l *dialogueLoop) shellTool(ctx context.Context, args map[string]any) (string, string) {
	cmdName, _ := args["command"].(string)
	if strings.TrimSpace(cmdName) == "" {
		return "missing command", "error"
	}

	var cmdArgs []string
	if rawArgs, ok := args["args"].([]any); ok {
		for _, item := range rawArgs {
			if s, ok := item.(string); ok {
				cmdArgs = append(cmdArgs, s)
			}
		}
	} else if rawArgs, ok := args["args"].([]string); ok {
		cmdArgs = append(cmdArgs, rawArgs...)
	}

	executor := NewShellExecutor()
	output, err := executor.Execute(ctx, cmdName, cmdArgs)
	if err != nil {
		// If Execute returns an error (validation error), return it.
		// Note: Execute returns (output, nil) even for command failure (with Error: ... in output).
		// So err here is likely validation error.
		return fmt.Sprintf("Validation error: %v", err), "error"
	}

	if output == "" {
		output = "(command completed with no output)"
	}
	return truncate(output, 2_048), "done"
}

func (l *dialogueLoop) completionsURL() string {
	base := normalizeBase(l.endpoint)
	switch l.provider {
	case "ollama":
		return base + "/api/chat"
	default:
		return base + "/v1/chat/completions"
	}
}

func (l *dialogueLoop) systemPrompt() string {
	hostOS := runtime.GOOS
	shellHint := "Shell tool executes commands directly without a wrapping shell; prefer POSIX-friendly commands and paths."
	if hostOS == "windows" {
		shellHint = "Shell tool uses PowerShell; prefer PowerShell-friendly commands and paths."
	}

	return fmt.Sprintf("You are shell-werk. Host OS: %s. %s When tools are present, use them. When the user request is satisfied, call the tool request_fullfilled with a concise summary.", hostOS, shellHint)
}

func parseArguments(raw string) (map[string]any, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func contentFromRequestFulfilled(args map[string]any, fallback string) string {
	if val, ok := args["summary"].(string); ok && strings.TrimSpace(val) != "" {
		return val
	}
	if strings.TrimSpace(fallback) != "" {
		return fallback
	}
	return "Request marked complete."
}

func truncate(text string, max int) string {
	if len(text) <= max {
		return text
	}
	if max <= 3 {
		return text[:max]
	}
	return text[:max-3] + "..."
}

func newTraceID() string {
	return fmt.Sprintf("trace-%d", time.Now().UnixNano())
}

