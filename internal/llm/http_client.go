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
	trimmed := strings.TrimSuffix(endpoint, "/")
	if trimmed == "" {
		return endpoint
	}
	return trimmed
}
