package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ChatProvider defines minimal chat capability.
type ChatProvider interface {
	Chat(ctx context.Context, req ChatRequest) (ChatMessage, error)
}

// MockProvider returns deterministic canned replies for tests and offline use.
type MockProvider struct{}

func (m MockProvider) Chat(_ context.Context, req ChatRequest) (ChatMessage, error) {
	content := fmt.Sprintf("[mock %s/%s] %s", strings.ToLower(req.Provider), req.Model, req.Message)
	return ChatMessage{Role: "assistant", Content: content}, nil
}

// OllamaProvider calls the Ollama HTTP API.
type OllamaProvider struct {
	client *http.Client
}

// VLLMProvider targets an OpenAI-compatible vLLM endpoint.
type VLLMProvider struct {
	client *http.Client
}

type chatPayload struct {
	Model      string        `json:"model"`
	Messages   []ChatMessage `json:"messages"`
	Stream     bool          `json:"stream"`
	ToolChoice string        `json:"tool_choice,omitempty"`
	Tools      any           `json:"tools,omitempty"`
}

type ollamaResponse struct {
	Message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"message"`
	Error string `json:"error"`
}

type openAIChoice struct {
	Message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"message"`
}

type vllmResponse struct {
	Choices []openAIChoice `json:"choices"`
	Error   struct {
		Message string `json:"message"`
	} `json:"error"`
}

func makeClient() *http.Client {
	return &http.Client{Timeout: 60 * time.Second}
}

func normalizeBase(endpoint string) string {
	trimmed := strings.TrimSuffix(endpoint, "/")
	if trimmed == "" {
		return endpoint
	}
	return trimmed
}

func (p OllamaProvider) Chat(ctx context.Context, req ChatRequest) (ChatMessage, error) {
	payload := chatPayload{
		Model:  req.Model,
		Stream: false,
		Messages: []ChatMessage{
			{Role: "user", Content: req.Message},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return ChatMessage{}, err
	}

	url := normalizeBase(req.Endpoint) + "/api/chat"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return ChatMessage{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return ChatMessage{}, err
	}
	defer resp.Body.Close()

	var decoded ollamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return ChatMessage{}, err
	}

	if decoded.Error != "" {
		return ChatMessage{}, errors.New(decoded.Error)
	}

	content := decoded.Message.Content
	if content == "" {
		content = "(no content returned)"
	}

	role := decoded.Message.Role
	if role == "" {
		role = "assistant"
	}

	return ChatMessage{Role: role, Content: content}, nil
}

func (p VLLMProvider) Chat(ctx context.Context, req ChatRequest) (ChatMessage, error) {
	payload := chatPayload{
		Model:  req.Model,
		Stream: false,
		Messages: []ChatMessage{
			{Role: "user", Content: req.Message},
		},
		ToolChoice: "auto",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return ChatMessage{}, err
	}

	url := normalizeBase(req.Endpoint) + "/v1/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return ChatMessage{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return ChatMessage{}, err
	}
	defer resp.Body.Close()

	var decoded vllmResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return ChatMessage{}, err
	}

	if decoded.Error.Message != "" {
		return ChatMessage{}, errors.New(decoded.Error.Message)
	}
	if len(decoded.Choices) == 0 {
		return ChatMessage{}, errors.New("empty response from vLLM")
	}

	content := decoded.Choices[0].Message.Content
	if content == "" {
		content = "(no content returned)"
	}
	role := decoded.Choices[0].Message.Role
	if role == "" {
		role = "assistant"
	}

	return ChatMessage{Role: role, Content: content}, nil
}

// ProviderFor chooses a provider implementation; defaults to mock.
func ProviderFor(name string) ChatProvider {
	switch strings.ToLower(name) {
	case "mock":
		return MockProvider{}
	case "ollama":
		return OllamaProvider{client: makeClient()}
	case "vllm":
		return VLLMProvider{client: makeClient()}
	default:
		return MockProvider{}
	}
}
