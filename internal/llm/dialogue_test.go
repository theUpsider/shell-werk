package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebSearchToolSuccess(t *testing.T) {
	ctx := context.Background()

	var called bool
	var token string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		token = r.Header.Get("X-Subscription-Token")

		if got := r.URL.Query().Get("q"); got != "golang" {
			t.Fatalf("expected query 'golang', got %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"web": map[string]any{
				"results": []map[string]any{
					{
						"title":       "Golang Docs",
						"url":         "https://go.dev",
						"description": "The Go Programming Language",
					},
				},
			},
		})
	}))
	defer server.Close()

	loop := &dialogueLoop{
		client:            server.Client(),
		webSearchAPIKey:   "secret-key",
		webSearchEndpoint: server.URL,
	}

	result, status := loop.webSearchTool(ctx, map[string]any{"query": "golang", "count": float64(1)})
	if status != "done" {
		t.Fatalf("expected status done, got %s", status)
	}
	if !called {
		t.Fatalf("expected web search endpoint to be called")
	}
	if token != "secret-key" {
		t.Fatalf("expected API token to be sent, got %q", token)
	}
	if !strings.Contains(result, "Golang Docs") || !strings.Contains(result, "https://go.dev") {
		t.Fatalf("unexpected search output: %s", result)
	}
}

func TestWebSearchToolMissingKey(t *testing.T) {
	ctx := context.Background()
	loop := &dialogueLoop{client: http.DefaultClient}

	result, status := loop.webSearchTool(ctx, map[string]any{"query": "test"})
	if status != "error" {
		t.Fatalf("expected error status, got %s", status)
	}
	if !strings.Contains(strings.ToLower(result), "api key") {
		t.Fatalf("expected API key guidance, got %q", result)
	}
}

func TestDecodeOllamaCompletion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"message": map[string]any{
				"role":    "assistant",
				"content": "hello",
				"tool_calls": []map[string]any{
					{
						"function": map[string]any{
							"name":      "search",
							"arguments": map[string]any{"query": "golang"},
						},
					},
				},
			},
			"done": true,
		})
	}))
	defer server.Close()

	loop := &dialogueLoop{provider: "ollama", endpoint: server.URL, model: "x", client: server.Client()}
	choice, err := loop.requestCompletion(context.Background(), []chatCompletionMessage{{Role: "user", Content: "hi"}}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if choice.Message.Content != "hello" {
		t.Fatalf("expected content 'hello', got %q", choice.Message.Content)
	}
	if choice.Message.Role != "assistant" {
		t.Fatalf("expected role assistant, got %q", choice.Message.Role)
	}
	if len(choice.Message.ToolCalls) != 1 {
		t.Fatalf("expected one tool call, got %d", len(choice.Message.ToolCalls))
	}
	if choice.Message.ToolCalls[0].Function.Name != "search" {
		t.Fatalf("unexpected tool call name: %q", choice.Message.ToolCalls[0].Function.Name)
	}
	if !strings.Contains(choice.Message.ToolCalls[0].Function.Arguments, "golang") {
		t.Fatalf("unexpected tool call arguments: %s", choice.Message.ToolCalls[0].Function.Arguments)
	}
}
