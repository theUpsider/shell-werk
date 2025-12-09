package main

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"shell-werk/internal/llm"
	"shell-werk/internal/shell"
	"shell-werk/internal/tools"
)

// App struct
type App struct {
	ctx            context.Context
	tools          *tools.ToolRegistry
	streamer       *llm.Streamer
	events         *appEventSink
	cancelMu       sync.Mutex
	cancelSessions map[string]cancelEntry
}

type cancelEntry struct {
	cancel context.CancelFunc
	token  string
}

// NewApp creates a new App application struct
func NewApp() *App {
	app := &App{
		tools:          tools.NewToolRegistry(tools.DefaultTools()),
		cancelSessions: map[string]cancelEntry{},
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

	ctx, cancel := context.WithCancel(ctx)
	token := a.trackSessionCancel(req.SessionID, cancel)
	defer a.releaseSessionCancel(req.SessionID, token, cancel)

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
			return ChatResponse{}, wrapProviderError(req.Provider, req.Endpoint, err)
		}
		return ChatResponse{
			Message:   msg,
			LatencyMs: time.Since(start).Milliseconds(),
		}, nil
	}

	ctx, timeoutCancel := context.WithTimeout(ctx, 120*time.Second)
	defer timeoutCancel()

	loop := llm.NewDialogueLoop(req, a.events)
	msg, trace, err := loop.Run(ctx, req)
	return ChatResponse{
		Message:   msg,
		LatencyMs: time.Since(start).Milliseconds(),
		Trace:     trace,
	}, wrapProviderError(req.Provider, req.Endpoint, err)
}

// CancelChat cancels an in-flight chat session if one exists.
func (a *App) CancelChat(sessionID string) bool {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false
	}

	a.cancelMu.Lock()
	entry, ok := a.cancelSessions[sessionID]
	if ok {
		delete(a.cancelSessions, sessionID)
	}
	a.cancelMu.Unlock()

	if !ok || entry.cancel == nil {
		return false
	}

	entry.cancel()
	return true
}

func (a *App) trackSessionCancel(sessionID string, cancel context.CancelFunc) string {
	if cancel == nil || strings.TrimSpace(sessionID) == "" {
		return ""
	}
	token := fmt.Sprintf("%d", time.Now().UnixNano())

	a.cancelMu.Lock()
	if a.cancelSessions == nil {
		a.cancelSessions = map[string]cancelEntry{}
	}
	a.cancelSessions[sessionID] = cancelEntry{cancel: cancel, token: token}
	a.cancelMu.Unlock()

	return token
}

func (a *App) releaseSessionCancel(sessionID, token string, cancel context.CancelFunc) {
	if cancel != nil {
		cancel()
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	a.cancelMu.Lock()
	entry, ok := a.cancelSessions[sessionID]
	if ok && entry.token == token {
		delete(a.cancelSessions, sessionID)
	}
	a.cancelMu.Unlock()
}

// Models returns the provider's available models for the configured endpoint.
func (a *App) Models(req ModelsRequest) (ModelsResponse, error) {
	models, err := llm.ListModels(a.ctx, req.Provider, req.Endpoint, req.APIKey, nil)
	if err != nil {
		return ModelsResponse{}, wrapProviderError(req.Provider, req.Endpoint, err)
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

func wrapProviderError(provider, endpoint string, err error) error {
	if err == nil {
		return nil
	}
	target := strings.TrimSpace(provider)
	if target == "" {
		target = "provider"
	}

	trimmedEndpoint := strings.TrimSpace(endpoint)
	if trimmedEndpoint != "" {
		target = fmt.Sprintf("%s @ %s", target, trimmedEndpoint)
	}

	return fmt.Errorf("%s: %w", target, err)
}
