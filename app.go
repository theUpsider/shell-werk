package main

import (
	"context"
	"fmt"
	"time"
)

// App struct
type App struct {
	ctx   context.Context
	tools *ToolRegistry
}

// ChatMessage represents a single message exchanged with the assistant.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest carries the minimal inputs to produce a reply.
type ChatRequest struct {
	SessionID string   `json:"sessionId"`
	Provider  string   `json:"provider"`
	Endpoint  string   `json:"endpoint"`
	APIKey    string   `json:"apiKey"`
	Model     string   `json:"model"`
	Message   string   `json:"message"`
	Tools     []string `json:"tools"`
	ChatOnly  bool     `json:"chatOnly"`
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
	msg, trace, err := loop.run(ctx, req.Message)
	return ChatResponse{
		Message:   msg,
		LatencyMs: time.Since(start).Milliseconds(),
		Trace:     trace,
	}, err
}

// Models returns the provider's available models for the configured endpoint.
func (a *App) Models(req ModelsRequest) (ModelsResponse, error) {
	models, err := ListModels(a.ctx, req.Provider, req.Endpoint, req.APIKey, nil)
	if err != nil {
		return ModelsResponse{}, err
	}

	return ModelsResponse{Models: models}, nil
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
