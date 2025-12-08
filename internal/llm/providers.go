package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"shell-werk/internal/tools"
)

// ChatProvider defines minimal chat capability.
type ChatProvider interface {
	Chat(ctx context.Context, req ChatRequest) (ChatMessage, error)
}

// MockProvider returns deterministic canned replies for tests and offline use.
type MockProvider struct{}

func (m MockProvider) Chat(_ context.Context, req ChatRequest) (ChatMessage, error) {
	conversation := ConversationFromRequest(req)

	// Use the latest user turn for deterministic echoing.
	latest := req.Message
	for i := len(conversation) - 1; i >= 0; i-- {
		if conversation[i].Role == "user" {
			latest = conversation[i].Content
			break
		}
	}

	content := fmt.Sprintf("[mock %s/%s] %s", strings.ToLower(req.Provider), req.Model, latest)
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
	Model      string                 `json:"model"`
	Messages   []ChatMessage          `json:"messages"`
	Stream     bool                   `json:"stream"`
	ToolChoice string                 `json:"tool_choice,omitempty"`
	Tools      []tools.ToolDefinition `json:"tools,omitempty"`
}

type ollamaToolCall struct {
	Function struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	} `json:"function"`
}

type ollamaResponse struct {
	Message struct {
		Role      string           `json:"role"`
		Content   string           `json:"content"`
		ToolCalls []ollamaToolCall `json:"tool_calls,omitempty"`
	} `json:"message"`
	Error string `json:"error"`
}

type openAIChoice struct {
	Message struct {
		Role      string     `json:"role"`
		Content   string     `json:"content"`
		ToolCalls []ToolCall `json:"tool_calls,omitempty"`
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

func (p OllamaProvider) Chat(ctx context.Context, req ChatRequest) (ChatMessage, error) {
	messages := ConversationFromRequest(req)

	payload := chatPayload{
		Model:    req.Model,
		Stream:   false,
		Messages: messages,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return ChatMessage{}, err
	}

	url := NormalizeBase(req.Endpoint) + "/api/chat"
	log.Printf("[%s] Sending Ollama request to %s with model %s", time.Now().Format(time.RFC3339), url, req.Model)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return ChatMessage{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return ChatMessage{}, fmt.Errorf("ollama request failed: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("[%s] Received Ollama response", time.Now().Format(time.RFC3339))

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return ChatMessage{}, fmt.Errorf("ollama response read failed: %w", err)
	}

	if resp.StatusCode >= http.StatusBadRequest {
		detail := strings.TrimSpace(string(rawBody))
		if detail == "" {
			detail = resp.Status
		}
		return ChatMessage{}, fmt.Errorf("ollama returned %s: %s", resp.Status, truncate(detail, 512))
	}

	var decoded ollamaResponse
	if err := json.Unmarshal(rawBody, &decoded); err != nil {
		return ChatMessage{}, fmt.Errorf("ollama decode failed: %w", err)
	}

	if decoded.Error != "" {
		return ChatMessage{}, fmt.Errorf("ollama error: %s", decoded.Error)
	}

	content := decoded.Message.Content
	if content == "" && len(decoded.Message.ToolCalls) == 0 {
		content = "(no content returned)"
	}

	role := decoded.Message.Role
	if role == "" {
		role = "assistant"
	}

	var toolCalls []ToolCall
	for _, tc := range decoded.Message.ToolCalls {
		argsBytes, _ := json.Marshal(tc.Function.Arguments)
		toolCalls = append(toolCalls, ToolCall{
			Type: "function",
			Function: ToolCallFunction{
				Name:      tc.Function.Name,
				Arguments: string(argsBytes),
			},
		})
	}

	return ChatMessage{Role: role, Content: content, ToolCalls: toolCalls}, nil
}

func (p VLLMProvider) Chat(ctx context.Context, req ChatRequest) (ChatMessage, error) {
	messages := ConversationFromRequest(req)

	payload := chatPayload{
		Model:    req.Model,
		Stream:   false,
		Messages: messages,
	}

	// Only request tool selection when tools are actually provided to avoid vLLM 400s.
	if len(req.Tools) > 0 {
		payload.ToolChoice = "auto"
		payload.Tools = req.ToolDefs
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return ChatMessage{}, err
	}

	url := NormalizeBase(req.Endpoint) + "/v1/chat/completions"
	log.Printf("[%s] Sending VLLM request to %s with model %s", time.Now().Format(time.RFC3339), url, req.Model)
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
		return ChatMessage{}, fmt.Errorf("vllm request failed: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("[%s] Received VLLM response", time.Now().Format(time.RFC3339))

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return ChatMessage{}, fmt.Errorf("vllm response read failed: %w", err)
	}

	if resp.StatusCode >= http.StatusBadRequest {
		detail := strings.TrimSpace(string(rawBody))
		if detail == "" {
			detail = resp.Status
		}
		return ChatMessage{}, fmt.Errorf("vllm returned %s: %s", resp.Status, truncate(detail, 512))
	}

	var decoded vllmResponse
	if err := json.Unmarshal(rawBody, &decoded); err != nil {
		return ChatMessage{}, fmt.Errorf("vllm decode failed: %w", err)
	}

	if decoded.Error.Message != "" {
		return ChatMessage{}, fmt.Errorf("vllm error: %s", decoded.Error.Message)
	}
	if len(decoded.Choices) == 0 {
		return ChatMessage{}, errors.New("empty response from vLLM")
	}

	content := decoded.Choices[0].Message.Content
	if content == "" && len(decoded.Choices[0].Message.ToolCalls) == 0 {
		content = "(no content returned)"
	}
	role := decoded.Choices[0].Message.Role
	if role == "" {
		role = "assistant"
	}

	return ChatMessage{Role: role, Content: content, ToolCalls: decoded.Choices[0].Message.ToolCalls}, nil
}

// ProviderFor chooses a provider implementation; defaults to mock.
func ProviderFor(name string) ChatProvider {
	switch strings.ToLower(name) {
	case "mock":
		return MockProvider{}
	case "ollama":
		return OllamaProvider{client: MakeClient()}
	case "vllm":
		return VLLMProvider{client: MakeClient()}
	default:
		return MockProvider{}
	}
}

// ListModels returns available model identifiers for the given provider and endpoint.
// The HTTP client can be injected for tests; MakeClient is used when nil.
func ListModels(ctx context.Context, provider, endpoint, apiKey string, client *http.Client) ([]string, error) {
	if client == nil {
		client = MakeClient()
	}

	base := NormalizeBase(endpoint)

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
