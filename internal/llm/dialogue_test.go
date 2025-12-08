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
