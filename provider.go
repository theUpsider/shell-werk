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

type ollamaTagsResponse struct {
	Models []struct {
		Name string `json:"name"`
	} `json:"models"`
}

type vllmModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
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
	if strings.TrimSpace(req.APIKey) != "" {
		httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
	}

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

// ListModels returns available model identifiers for the given provider and endpoint.
// The HTTP client can be injected for tests; makeClient is used when nil.
func ListModels(ctx context.Context, provider, endpoint, apiKey string, client *http.Client) ([]string, error) {
	if client == nil {
		client = makeClient()
	}

	base := normalizeBase(endpoint)

	switch strings.ToLower(provider) {
	case "ollama":
		return listOllamaModels(ctx, base, client)
	case "vllm":
		return listVLLMModels(ctx, base, apiKey, client)
	case "mock":
		return []string{"mock"}, nil
	default:
		return nil, fmt.Errorf("unsupported provider %q", provider)
	}
}

func listOllamaModels(ctx context.Context, base string, client *http.Client) ([]string, error) {
	url := base + "/api/tags"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("ollama list models: %s", resp.Status)
	}

	var decoded ollamaTagsResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, err
	}

	var models []string
	for _, model := range decoded.Models {
		if strings.TrimSpace(model.Name) != "" {
			models = append(models, model.Name)
		}
	}
	return models, nil
}

func listVLLMModels(ctx context.Context, base, apiKey string, client *http.Client) ([]string, error) {
	url := base + "/v1/models"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("vllm list models: %s", resp.Status)
	}

	var decoded vllmModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, err
	}

	var models []string
	for _, model := range decoded.Data {
		if strings.TrimSpace(model.ID) != "" {
			models = append(models, model.ID)
		}
	}
	return models, nil
}
