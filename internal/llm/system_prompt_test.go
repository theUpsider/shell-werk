package llm

import (
	"os"
	"strings"
	"testing"
)

func TestSystemPromptLoaderUsesEmbeddedTemplate(t *testing.T) {
	loader := DefaultSystemPromptLoader()

	prompt, err := loader.Load("linux")
	if err != nil {
		t.Fatalf("unexpected error loading prompt: %v", err)
	}
	if !strings.Contains(prompt, "linux") {
		t.Fatalf("expected host OS to appear in prompt: %q", prompt)
	}
	if strings.Contains(prompt, "SHELL_HINT") {
		t.Fatalf("unexpected shell hint placeholder in prompt: %q", prompt)
	}
}

func TestSystemPromptLoaderReadsOverrideFile(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/prompt.txt"
	if err := os.WriteFile(path, []byte("Hello {{HOST_OS}}"), 0o644); err != nil {
		t.Fatalf("failed to write override file: %v", err)
	}

	loader := NewSystemPromptLoader(path)
	prompt, err := loader.Load("darwin")
	if err != nil {
		t.Fatalf("unexpected error loading override prompt: %v", err)
	}

	expected := "Hello darwin"
	if prompt != expected {
		t.Fatalf("expected %q, got %q", expected, prompt)
	}
}
