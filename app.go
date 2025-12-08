package main

import (
	"context"
	"fmt"
	"time"

	"shell-werk/internal/llm"
	"shell-werk/internal/shell"
	"shell-werk/internal/tools"
)

// App struct
type App struct {
	ctx      context.Context
	tools    *tools.ToolRegistry
	streamer *llm.Streamer
	events   *appEventSink
}

// NewApp creates a new App application struct
func NewApp() *App {
	app := &App{
		tools: tools.NewToolRegistry(tools.DefaultTools()),
	}
	app.events = &appEventSink{app: app}
	app.streamer = llm.NewStreamer(app.events)
	return app
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

// Chat proxies to the configured provider and returns the response.
func (a *App) Chat(req ChatRequest) (ChatResponse, error) {
	start := time.Now()

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	req.History = llm.ConversationFromRequest(req)
	req.Message = ""

	for _, id := range req.Tools {
		if tool, ok := a.tools.Get(id); ok {
			req.ToolDefs = append(req.ToolDefs, tool.Definition)
		}
	}

	a.events.ThinkingStart(req.SessionID)
	defer a.events.ThinkingEnd(req.SessionID)

	if len(req.Tools) == 0 {
		msg, err := a.streamer.StreamChat(ctx, req)
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

	loop := llm.NewDialogueLoop(req)
	msg, trace, err := loop.Run(ctx, req)
	return ChatResponse{
		Message:   msg,
		LatencyMs: time.Since(start).Milliseconds(),
		Trace:     trace,
	}, err
}

// Models returns the provider's available models for the configured endpoint.
func (a *App) Models(req ModelsRequest) (ModelsResponse, error) {
	models, err := llm.ListModels(a.ctx, req.Provider, req.Endpoint, req.APIKey, nil)
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
	executor := shell.NewExecutor()
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
