package llm

import (
	"net/http"
	"strings"
	"time"
)

func MakeClient() *http.Client {
	return &http.Client{Timeout: 60 * time.Second}
}

func NormalizeBase(endpoint string) string {
	trimmed := strings.TrimSpace(endpoint)
	trimmed = strings.TrimSuffix(trimmed, "/")
	if trimmed == "" {
		return ""
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "http://" + trimmed
	}
	return trimmed
}
