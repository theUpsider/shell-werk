package main

import (
	"context"
	"fmt"
	"strings"
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

// ProviderFor chooses a provider implementation; defaults to mock.
func ProviderFor(name string) ChatProvider {
	switch strings.ToLower(name) {
	case "mock":
		return MockProvider{}
	case "ollama":
		// TODO: Implement real Ollama provider
		return MockProvider{}
	case "vllm":
		// TODO: Implement real vLLM provider
		return MockProvider{}
	default:
		return MockProvider{}
	}
}
