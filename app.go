package main

import (
	"context"
	"fmt"
	"time"
)

// App struct
type App struct {
	ctx context.Context
}

// ChatMessage represents a single message exchanged with the assistant.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest carries the minimal inputs to produce a reply.
type ChatRequest struct {
	SessionID string `json:"sessionId"`
	Provider  string `json:"provider"`
	Endpoint  string `json:"endpoint"`
	Model     string `json:"model"`
	Message   string `json:"message"`
}

// ChatResponse returns the assistant message content (stubbed for now).
type ChatResponse struct {
	Message   ChatMessage `json:"message"`
	LatencyMs int64       `json:"latencyMs"`
}

// ModelsRequest carries provider configuration to list available models.
type ModelsRequest struct {
	Provider string `json:"provider"`
	Endpoint string `json:"endpoint"`
}

// ModelsResponse wraps the provider model names.
type ModelsResponse struct {
	Models []string `json:"models"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
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
	provider := ProviderFor(req.Provider)
	msg, err := provider.Chat(a.ctx, req)
	if err != nil {
		return ChatResponse{}, err
	}

	return ChatResponse{
		Message:   msg,
		LatencyMs: time.Since(start).Milliseconds(),
	}, nil
}

// Models returns the provider's available models for the configured endpoint.
func (a *App) Models(req ModelsRequest) (ModelsResponse, error) {
	models, err := ListModels(a.ctx, req.Provider, req.Endpoint, nil)
	if err != nil {
		return ModelsResponse{}, err
	}

	return ModelsResponse{Models: models}, nil
}
