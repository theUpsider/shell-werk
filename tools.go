package main

import (
	"fmt"
	"sync"
)

// ToolMetadata describes a tool and how it should appear in the UI.
type ToolMetadata struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	UIVisible   bool   `json:"uiVisible"`
	Enabled     bool   `json:"enabled"`
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
		},
		{
			ID:          "browser",
			Name:        "Browser",
			Description: "Fetch web content for context.",
			UIVisible:   true,
			Enabled:     true,
		},
	}
}
