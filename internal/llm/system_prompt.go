package llm

import (
	_ "embed"
	"errors"
	"fmt"
	"os"
	"strings"
)

const SystemPromptEnvPath = "SHELLWERK_SYSTEM_PROMPT_PATH"

//go:embed prompts/system_prompt.txt
var embeddedSystemPrompt string

// SystemPromptLoader retrieves the system prompt from an embedded or external configuration file.
type SystemPromptLoader struct {
	path string
}

// DefaultSystemPromptLoader returns a loader that prefers the environment override but falls back to the embedded prompt.
func DefaultSystemPromptLoader() *SystemPromptLoader {
	return NewSystemPromptLoader("")
}

// NewSystemPromptLoader constructs a loader with an optional explicit path. An empty path defers to the environment override.
func NewSystemPromptLoader(path string) *SystemPromptLoader {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		trimmed = strings.TrimSpace(os.Getenv(SystemPromptEnvPath))
	}
	return &SystemPromptLoader{path: trimmed}
}

// Load returns the system prompt with host-specific hints injected.
func (l *SystemPromptLoader) Load(hostOS string) (string, error) {
	source := strings.TrimSpace(embeddedSystemPrompt)
	if l.path != "" {
		data, err := os.ReadFile(l.path)
		if err != nil {
			return "", fmt.Errorf("read system prompt from %s: %w", l.path, err)
		}
		source = strings.TrimSpace(string(data))
	}

	if source == "" {
		return "", errors.New("system prompt is empty")
	}

	prompt := strings.ReplaceAll(source, "{{HOST_OS}}", hostOS)

	if strings.Contains(prompt, "{{HOST_OS}}") {
		return "", errors.New("system prompt template is missing replacement for HOST_OS")
	}

	return prompt, nil
}
