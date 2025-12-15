package main

import (
	"strings"
	"testing"
)

func TestChatRespectsChatOnly(t *testing.T) {
	app := NewApp()

	resp, err := app.Chat(ChatRequest{
		Provider: "mock",
		Model:    "test-model",
		Message:  "hello world",
		ChatOnly: true,
		Tools:    []string{"web_search", "shell"},
	})
	if err != nil {
		t.Fatalf("Chat returned error: %v", err)
	}

	if len(resp.Trace) != 0 {
		t.Fatalf("expected no dialogue trace in chat-only mode, got %d entries", len(resp.Trace))
	}

	if !strings.Contains(resp.Message.Content, "hello world") {
		t.Fatalf("unexpected chat response: %q", resp.Message.Content)
	}
}
