package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeBase(t *testing.T) {
	cases := map[string]string{
		"https://example.com/":         "https://example.com",
		"https://example.com":          "https://example.com",
		"localhost:11434":              "http://localhost:11434",
		" http://localhost:11434/ ":    "http://localhost:11434",
		"":                             "",
	}

	for input, expected := range cases {
		if got := NormalizeBase(input); got != expected {
			t.Errorf("NormalizeBase(%q) = %q, want %q", input, got, expected)
		}
	}
}

func TestProviderFor(t *testing.T) {
	cases := []string{"mock", "ollama", "vllm", ""}

	for _, name := range cases {
		provider := ProviderFor(name)
		if strings.ToLower(name) == "ollama" {
			if _, ok := provider.(OllamaProvider); !ok {
				t.Errorf("ProviderFor(%q) = %T, want OllamaProvider", name, provider)
			}
			continue
		}
		if strings.ToLower(name) == "vllm" {
			if _, ok := provider.(VLLMProvider); !ok {
				t.Errorf("ProviderFor(%q) = %T, want VLLMProvider", name, provider)
			}
			continue
		}
		if _, ok := provider.(MockProvider); !ok {
			t.Errorf("ProviderFor(%q) = %T, want MockProvider", name, provider)
		}
	}
}

func TestMockProviderChat(t *testing.T) {
	provider := MockProvider{}
	msg, err := provider.Chat(context.Background(), ChatRequest{Provider: "Mock", Model: "test", Message: "ping"})
	if err != nil {
		t.Fatalf("MockProvider.Chat returned error: %v", err)
	}
	if msg.Role != "assistant" {
		t.Fatalf("unexpected role: %q", msg.Role)
	}
	if msg.Content != "[mock mock/test] ping" {
		t.Fatalf("unexpected content: %q", msg.Content)
	}
}

func TestOllamaProviderChatSuccess(t *testing.T) {
	var received chatPayload
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Fatalf("unexpected content type: %s", ct)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("failed to decode payload: %v", err)
		}
		resp := ollamaResponse{}
		resp.Message.Role = "assistant"
		resp.Message.Content = "hello"
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	provider := OllamaProvider{client: server.Client()}
	msg, err := provider.Chat(context.Background(), ChatRequest{Endpoint: server.URL, Model: "llama3", Message: "hi"})
	if err != nil {
		t.Fatalf("OllamaProvider.Chat returned error: %v", err)
	}

	if received.Stream {
		t.Fatalf("expected stream=false")
	}
	if received.Model != "llama3" {
		t.Fatalf("expected model to match request, got %q", received.Model)
	}
	if len(received.Messages) != 1 || received.Messages[0].Content != "hi" {
		t.Fatalf("unexpected messages payload: %+v", received.Messages)
	}
	if msg.Role != "assistant" || msg.Content != "hello" {
		t.Fatalf("unexpected response message: %+v", msg)
	}
}

func TestOllamaProviderChatDefaultsAndError(t *testing.T) {
	t.Run("defaults role and content", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(ollamaResponse{})
		}))
		defer server.Close()

		provider := OllamaProvider{client: server.Client()}
		msg, err := provider.Chat(context.Background(), ChatRequest{Endpoint: server.URL, Model: "x", Message: "hi"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if msg.Role != "assistant" {
			t.Fatalf("expected default role 'assistant', got %q", msg.Role)
		}
		if msg.Content != "(no content returned)" {
			t.Fatalf("expected default content, got %q", msg.Content)
		}
	})

	t.Run("returns API error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(ollamaResponse{Error: "boom"})
		}))
		defer server.Close()

		provider := OllamaProvider{client: server.Client()}
		_, err := provider.Chat(context.Background(), ChatRequest{Endpoint: server.URL, Model: "x", Message: "hi"})
		if err == nil || !strings.Contains(err.Error(), "boom") {
			t.Fatalf("expected error 'boom', got %v", err)
		}
	})
}

func TestVLLMProviderChatSuccess(t *testing.T) {
	var received chatPayload
	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("failed to decode payload: %v", err)
		}
		resp := vllmResponse{Choices: []openAIChoice{{}}}
		resp.Choices[0].Message.Role = "assistant"
		resp.Choices[0].Message.Content = "pong"
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	provider := VLLMProvider{client: server.Client()}
	msg, err := provider.Chat(context.Background(), ChatRequest{Endpoint: server.URL, Model: "mistral", Message: "ping", APIKey: "secret", Tools: []string{"browser"}})
	if err != nil {
		t.Fatalf("VLLMProvider.Chat returned error: %v", err)
	}

	if received.ToolChoice != "auto" {
		t.Fatalf("expected tool_choice auto, got %q", received.ToolChoice)
	}
	if len(received.Messages) != 1 || received.Messages[0].Content != "ping" {
		t.Fatalf("unexpected messages payload: %+v", received.Messages)
	}
	if msg.Role != "assistant" || msg.Content != "pong" {
		t.Fatalf("unexpected response message: %+v", msg)
	}
	if authHeader != "Bearer secret" {
		t.Fatalf("expected Authorization header to be set, got %q", authHeader)
	}
}

func TestVLLMProviderChatDefaultsAndErrors(t *testing.T) {
	t.Run("defaults role and content", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(vllmResponse{Choices: []openAIChoice{{}}})
		}))
		defer server.Close()

		provider := VLLMProvider{client: server.Client()}
		msg, err := provider.Chat(context.Background(), ChatRequest{Endpoint: server.URL, Model: "x", Message: "hi"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if msg.Role != "assistant" {
			t.Fatalf("expected default role 'assistant', got %q", msg.Role)
		}
		if msg.Content != "(no content returned)" {
			t.Fatalf("expected default content, got %q", msg.Content)
		}
	})

	t.Run("returns API error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(vllmResponse{Error: struct {
				Message string `json:"message"`
			}{Message: "nope"}})
		}))
		defer server.Close()

		provider := VLLMProvider{client: server.Client()}
		_, err := provider.Chat(context.Background(), ChatRequest{Endpoint: server.URL, Model: "x", Message: "hi"})
		if err == nil || !strings.Contains(err.Error(), "nope") {
			t.Fatalf("expected error 'nope', got %v", err)
		}
	})

	t.Run("empty choices error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(vllmResponse{})
		}))
		defer server.Close()

		provider := VLLMProvider{client: server.Client()}
		_, err := provider.Chat(context.Background(), ChatRequest{Endpoint: server.URL, Model: "x", Message: "hi"})
		if err == nil || !strings.Contains(err.Error(), "empty response") {
			t.Fatalf("expected empty response error, got %v", err)
		}
	})
}

func TestListModelsOllama(t *testing.T) {
	var called bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.URL.Path != "/api/tags" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(ollamaTagsResponse{Models: []struct {
			Name string `json:"name"`
		}{{Name: "llama3"}, {Name: ""}}})
	}))
	defer server.Close()

	models, err := ListModels(context.Background(), "ollama", server.URL, "", server.Client())
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if !called {
		t.Fatalf("expected request to be sent")
	}
	if len(models) != 1 || models[0] != "llama3" {
		t.Fatalf("unexpected models: %+v", models)
	}
}

func TestListModelsVLLM(t *testing.T) {
	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		authHeader = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(vllmModelsResponse{Data: []struct {
			ID string `json:"id"`
		}{{ID: "mixtral"}, {ID: ""}}})
	}))
	defer server.Close()

	models, err := ListModels(context.Background(), "vllm", server.URL, "secret", server.Client())
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if len(models) != 1 || models[0] != "mixtral" {
		t.Fatalf("unexpected models: %+v", models)
	}
	if authHeader != "Bearer secret" {
		t.Fatalf("expected Authorization header to be set, got %q", authHeader)
	}
}

func TestListModelsErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	_, err := ListModels(context.Background(), "ollama", server.URL, "", server.Client())
	if err == nil || !strings.Contains(err.Error(), "ollama list models") {
		t.Fatalf("expected ollama error, got %v", err)
	}

	if _, err := ListModels(context.Background(), "unknown", server.URL, "", server.Client()); err == nil {
		t.Fatalf("expected error for unsupported provider")
	}
}
