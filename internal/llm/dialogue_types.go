package llm

import "shell-werk/internal/tools"

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
	Tools       []tools.ToolDefinition  `json:"tools,omitempty"`
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
