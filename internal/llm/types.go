package llm

import (
	"time"

	"shell-werk/internal/tools"
)

// ToolCall represents a request to run a tool.
type ToolCall struct {
	ID       string           `json:"id,omitempty"`
	Type     string           `json:"type"`
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
	SessionID string                 `json:"sessionId"`
	Provider  string                 `json:"provider"`
	Endpoint  string                 `json:"endpoint"`
	APIKey    string                 `json:"apiKey"`
	Model     string                 `json:"model"`
	Message   string                 `json:"message"`
	History   []ChatMessage          `json:"history"`
	Tools     []string               `json:"tools"`
	ChatOnly  bool                   `json:"chatOnly"`
	ToolDefs  []tools.ToolDefinition `json:"-"`
}

// ChatResponse returns the assistant message content.
type ChatResponse struct {
	Message   ChatMessage     `json:"message"`
	LatencyMs int64           `json:"latencyMs"`
	Trace     []DialogueTrace `json:"trace"`
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
