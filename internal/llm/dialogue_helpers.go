package llm

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func parseArguments(raw string) (map[string]any, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func contentFromRequestFulfilled(args map[string]any, fallback string) string {
	if val, ok := args["summary"].(string); ok && strings.TrimSpace(val) != "" {
		return val
	}
	if strings.TrimSpace(fallback) != "" {
		return fallback
	}
	return "Request marked complete."
}

func truncate(text string, max int) string {
	if len(text) <= max {
		return text
	}
	if max <= 3 {
		return text[:max]
	}
	return text[:max-3] + "..."
}

func newTraceID() string {
	return fmt.Sprintf("trace-%d", time.Now().UnixNano())
}
