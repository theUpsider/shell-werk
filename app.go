package main

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// App struct
type App struct {
	ctx   context.Context
	tools *ToolRegistry
}

// ToolCall represents a request to run a tool.
type ToolCall struct {
	ID       string         `json:"id,omitempty"`
	Type     string         `json:"type"`
	Function ToolCallFunction `json:"function"`
}

// ToolCallFunction describes the function to call.
type ToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string of arguments
}

// ChatMessage represents a single message exchanged with the assistant.
type ChatMessage struct {
	Role      string     `json:"role"`
	Content   string     `json:"content"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// ChatRequest carries the minimal inputs to produce a reply.
type ChatRequest struct {
	SessionID string        `json:"sessionId"`
	Provider  string        `json:"provider"`
	Endpoint  string        `json:"endpoint"`
	APIKey    string        `json:"apiKey"`
	Model     string        `json:"model"`
	Message   string           `json:"message"`
	History   []ChatMessage    `json:"history"`
	Tools     []string         `json:"tools"`
	ChatOnly  bool             `json:"chatOnly"`
	ToolDefs  []ToolDefinition `json:"-"`
}

// ChatResponse returns the assistant message content (stubbed for now).
type ChatResponse struct {
	Message   ChatMessage     `json:"message"`
	LatencyMs int64           `json:"latencyMs"`
	Trace     []DialogueTrace `json:"trace"`
}

// SetToolEnabledRequest toggles a tool's enabled state.
type SetToolEnabledRequest struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

// ModelsRequest carries provider configuration to list available models.
type ModelsRequest struct {
	Provider string `json:"provider"`
	Endpoint string `json:"endpoint"`
	APIKey   string `json:"apiKey"`
}

// ModelsResponse wraps the provider model names.
type ModelsResponse struct {
	Models []string `json:"models"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{tools: NewToolRegistry(defaultTools())}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// Chat proxies to the configured provider (mock for now) and returns the response.
func (a *App) Chat(req ChatRequest) (ChatResponse, error) {
	start := time.Now()

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	// Normalize the incoming history and append the latest user message so all providers
	// and the dialogue loop receive the full conversation context.
	req.History = conversationFromRequest(req)
	// The latest user turn is now embedded in History; clear Message to avoid double-appending downstream.
	req.Message = ""

	// Resolve tool definitions
	for _, id := range req.Tools {
		if tool, ok := a.tools.Get(id); ok {
			req.ToolDefs = append(req.ToolDefs, tool.Definition)
		}
	}

	if req.ChatOnly || len(req.Tools) == 0 {
		provider := ProviderFor(req.Provider)
		msg, err := provider.Chat(ctx, req)
		if err != nil {
			return ChatResponse{}, err
		}
		return ChatResponse{
			Message:   msg,
			LatencyMs: time.Since(start).Milliseconds(),
		}, nil
	}

	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	loop := newDialogueLoop(req)
	msg, trace, err := loop.run(ctx, req)
	return ChatResponse{
		Message:   msg,
		LatencyMs: time.Since(start).Milliseconds(),
		Trace:     trace,
	}, err
}

// conversationFromRequest merges prior user/assistant turns with the latest user
// message, ignoring tool/system entries to keep provider payloads valid.
func conversationFromRequest(req ChatRequest) []ChatMessage {
	history := normalizeHistory(req.History)

	if text := strings.TrimSpace(req.Message); text != "" {
		history = append(history, ChatMessage{Role: "user", Content: text})
	}

	return history
}

// normalizeHistory filters out empty content and non-dialogue roles. It preserves
// chronological order for the model while avoiding placeholder messages.
func normalizeHistory(history []ChatMessage) []ChatMessage {
	cleaned := make([]ChatMessage, 0, len(history))
	for _, msg := range history {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(msg.Content)
		if content == "" {
			continue
		}
		cleaned = append(cleaned, ChatMessage{Role: role, Content: content})
	}
	return cleaned
}

// Models returns the provider's available models for the configured endpoint.
func (a *App) Models(req ModelsRequest) (ModelsResponse, error) {
	models, err := ListModels(a.ctx, req.Provider, req.Endpoint, req.APIKey, nil)
	if err != nil {
		return ModelsResponse{}, err
	}

	return ModelsResponse{Models: models}, nil
}

// RunShellCommand executes a shell command.
func (a *App) RunShellCommand(command string, args []string, chatOnly bool) (string, error) {
	if chatOnly {
		return "", fmt.Errorf("shell execution disabled in chat-only mode")
	}
	executor := NewShellExecutor()
	return executor.Execute(a.ctx, command, args)
}

// GetTools returns the tool metadata for UI rendering and configuration.
func (a *App) GetTools() []ToolMetadata {
	return a.tools.List()
}

// SetToolEnabled flips the enabled flag for a tool and returns the updated list.
func (a *App) SetToolEnabled(req SetToolEnabledRequest) ([]ToolMetadata, error) {
	if _, err := a.tools.SetEnabled(req.ID, req.Enabled); err != nil {
		return nil, err
	}

	return a.tools.List(), nil
}
