package main

import (
	"fmt"
	"sync"
)

// ToolMetadata describes a tool and how it should appear in the UI.
type ToolMetadata struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	UIVisible   bool           `json:"uiVisible"`
	Enabled     bool           `json:"enabled"`
	Definition  ToolDefinition `json:"-"`
}

// ToolFunctionDef describes the function signature for the LLM.
type ToolFunctionDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
	Strict      bool           `json:"strict,omitempty"`
}

// ToolDefinition wraps the function definition for OpenAI-compatible APIs.
type ToolDefinition struct {
	Type     string          `json:"type"`
	Function ToolFunctionDef `json:"function"`
}

// ToolRegistry stores tool definitions and enabled state.
type ToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]ToolMetadata
	order []string
}

// NewToolRegistry seeds the registry from the given defaults.
func NewToolRegistry(defaults []ToolMetadata) *ToolRegistry {
	tools := make(map[string]ToolMetadata, len(defaults))
	order := make([]string, 0, len(defaults))

	for _, tool := range defaults {
		if tool.ID == "" {
			continue
		}
		// If duplicates exist, the first definition wins to keep ordering stable.
		if _, exists := tools[tool.ID]; exists {
			continue
		}
		tools[tool.ID] = tool
		order = append(order, tool.ID)
	}

	return &ToolRegistry{tools: tools, order: order}
}

// List returns a copy of the tool metadata in a deterministic order.
func (r *ToolRegistry) List() []ToolMetadata {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]ToolMetadata, 0, len(r.order))
	for _, id := range r.order {
		if tool, ok := r.tools[id]; ok {
			out = append(out, tool)
		}
	}
	return out
}

// Get returns the metadata for a specific tool.
func (r *ToolRegistry) Get(id string) (ToolMetadata, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tool, ok := r.tools[id]
	return tool, ok
}

// SetEnabled updates the enabled flag for a tool.
func (r *ToolRegistry) SetEnabled(id string, enabled bool) (ToolMetadata, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	tool, ok := r.tools[id]
	if !ok {
		return ToolMetadata{}, fmt.Errorf("unknown tool %q", id)
	}

	tool.Enabled = enabled
	r.tools[id] = tool
	return tool, nil
}

// defaultTools returns the built-in tool set and their UI visibility hints.
func defaultTools() []ToolMetadata {
	return []ToolMetadata{
		{
			ID:          "shell",
			Name:        "Shell",
			Description: "Execute shell commands with confirmation.",
			UIVisible:   false,
			Enabled:     true,
			Definition: ToolDefinition{
				Type: "function",
				Function: ToolFunctionDef{
					Name:        "shell",
					Description: "Run a whitelisted local command (echo, ls/dir, pwd).",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"command": map[string]any{
								"type":        "string",
								"description": "Command name (echo, ls, dir, pwd)",
							},
							"args": map[string]any{
								"type":        "array",
								"items":       map[string]any{"type": "string"},
								"description": "Arguments for the command",
							},
						},
						"required": []string{"command"},
					},
				},
			},
		},
		{
			ID:          "browser",
			Name:        "Browser",
			Description: "Fetch web content for context.",
			UIVisible:   true,
			Enabled:     true,
			Definition: ToolDefinition{
				Type: "function",
				Function: ToolFunctionDef{
					Name:        "browser",
					Description: "Fetch a URL and return a short text preview.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"url": map[string]any{
								"type":        "string",
								"description": "HTTP or HTTPS URL to fetch",
							},
							"maxBytes": map[string]any{
								"type":        "number",
								"description": "Optional maximum bytes to read (default 2048)",
							},
						},
						"required": []string{"url"},
					},
				},
			},
		},
		{
			ID:          "request_fullfilled",
			Name:        "Request Fulfilled",
			Description: "Signal completion.",
			UIVisible:   false,
			Enabled:     true,
			Definition: ToolDefinition{
				Type: "function",
				Function: ToolFunctionDef{
					Name:        "request_fullfilled",
					Description: "Signal that the user request is complete and provide the final answer.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"summary": map[string]any{
								"type":        "string",
								"description": "Final answer to present to the user",
							},
						},
						"required": []string{"summary"},
					},
				},
			},
		},
	}
}
