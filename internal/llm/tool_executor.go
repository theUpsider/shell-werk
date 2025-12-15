package llm

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"shell-werk/internal/shell"
)

type ToolExecutor interface {
	Execute(ctx context.Context, name string, args map[string]any) (string, string)
}

type ToolExecutorConfig struct {
	Client            *http.Client
	WebSearchAPIKey   string
	WebSearchEndpoint string
	ShellFactory      func() *shell.Executor
}

type defaultToolExecutor struct {
	client            *http.Client
	webSearchAPIKey   string
	webSearchEndpoint string
	shellFactory      func() *shell.Executor
}

func NewToolExecutor(cfg ToolExecutorConfig) ToolExecutor {
	client := cfg.Client
	if client == nil {
		client = MakeClient()
	}

	endpoint := cfg.WebSearchEndpoint
	if strings.TrimSpace(endpoint) == "" {
		endpoint = braveSearchEndpointDefault
	}

	shellFactory := cfg.ShellFactory
	if shellFactory == nil {
		shellFactory = shell.NewExecutor
	}

	return &defaultToolExecutor{
		client:            client,
		webSearchAPIKey:   strings.TrimSpace(cfg.WebSearchAPIKey),
		webSearchEndpoint: endpoint,
		shellFactory:      shellFactory,
	}
}

func (e *defaultToolExecutor) Execute(ctx context.Context, name string, args map[string]any) (string, string) {
	switch name {
	case "browser":
		return e.browser(ctx, args)
	case "shell":
		return e.shell(ctx, args)
	case "web_search":
		return e.webSearch(ctx, args)
	default:
		return fmt.Sprintf("tool %s is not implemented", name), "error"
	}
}

func (e *defaultToolExecutor) browser(ctx context.Context, args map[string]any) (string, string) {
	rawURL, _ := args["url"].(string)
	if strings.TrimSpace(rawURL) == "" {
		return "missing url argument", "error"
	}

	maxBytes := 2_048
	if val, ok := args["maxBytes"].(float64); ok && val > 256 {
		maxBytes = int(val)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return fmt.Sprintf("request build failed: %v", err), "error"
	}

	resp, err := e.client.Do(req)
	if err != nil {
		return fmt.Sprintf("request failed: %v", err), "error"
	}
	defer resp.Body.Close()

	limited := io.LimitedReader{R: resp.Body, N: int64(maxBytes)}
	buf, err := io.ReadAll(&limited)
	if err != nil {
		return fmt.Sprintf("read failed: %v", err), "error"
	}

	preview := strings.TrimSpace(string(buf))
	if preview == "" {
		preview = fmt.Sprintf("(%s returned no body)", rawURL)
	}
	return truncate(preview, maxBytes), "done"
}

func (e *defaultToolExecutor) shell(ctx context.Context, args map[string]any) (string, string) {
	cmdName, _ := args["command"].(string)
	if strings.TrimSpace(cmdName) == "" {
		return "missing command", "error"
	}

	var cmdArgs []string
	if rawArgs, ok := args["args"].([]any); ok {
		for _, item := range rawArgs {
			if s, ok := item.(string); ok {
				cmdArgs = append(cmdArgs, s)
			}
		}
	} else if rawArgs, ok := args["args"].([]string); ok {
		cmdArgs = append(cmdArgs, rawArgs...)
	}

	executor := e.shellFactory()
	output, err := executor.Execute(ctx, cmdName, cmdArgs)
	if err != nil {
		failure := strings.TrimSpace(output)
		if failure == "" {
			failure = err.Error()
		}
		return truncate(failure, 2_048), "error"
	}

	if output == "" {
		output = "(command completed with no output)"
	}
	return truncate(output, 2_048), "done"
}

func (e *defaultToolExecutor) webSearch(ctx context.Context, args map[string]any) (string, string) {
	query, _ := args["query"].(string)
	if strings.TrimSpace(query) == "" {
		return "missing query", "error"
	}

	if e.webSearchAPIKey == "" {
		return "Brave Search API key is not set. Add it in Settings before using web search.", "error"
	}

	count := 3
	if val, ok := args["count"].(float64); ok {
		if parsed := int(val); parsed >= 1 && parsed <= 20 {
			count = parsed
		}
	}

	searchURL := strings.TrimSpace(e.webSearchEndpoint)
	if searchURL == "" {
		searchURL = braveSearchEndpointDefault
	}

	parsedURL, err := url.Parse(searchURL)
	if err != nil {
		return fmt.Sprintf("invalid search endpoint: %v", err), "error"
	}
	q := parsedURL.Query()
	q.Set("q", query)
	q.Set("count", strconv.Itoa(count))
	parsedURL.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsedURL.String(), nil)
	if err != nil {
		return fmt.Sprintf("request build failed: %v", err), "error"
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("X-Subscription-Token", e.webSearchAPIKey)

	resp, err := e.client.Do(req)
	if err != nil {
		return fmt.Sprintf("search request failed: %v", err), "error"
	}
	defer resp.Body.Close()

	var reader io.Reader = resp.Body
	var gz *gzip.Reader
	if strings.Contains(resp.Header.Get("Content-Encoding"), "gzip") {
		gz, err = gzip.NewReader(resp.Body)
		if err != nil {
			return fmt.Sprintf("failed to decompress response: %v", err), "error"
		}
		defer gz.Close()
		reader = gz
	}

	if resp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(io.LimitReader(reader, 2_048))
		detail := strings.TrimSpace(string(body))
		if detail == "" {
			detail = resp.Status
		}
		return fmt.Sprintf("Brave Search returned %s: %s", resp.Status, truncate(detail, 512)), "error"
	}

	var decoded struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
			} `json:"results"`
		} `json:"web"`
	}

	if err := json.NewDecoder(reader).Decode(&decoded); err != nil {
		return fmt.Sprintf("decode failed: %v", err), "error"
	}

	if len(decoded.Web.Results) == 0 {
		return fmt.Sprintf("No results found for %q.", query), "done"
	}

	var builder strings.Builder
	for i, item := range decoded.Web.Results {
		if i >= count {
			break
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = "(untitled result)"
		}
		fmt.Fprintf(&builder, "%d. %s\n%s\n", i+1, title, strings.TrimSpace(item.URL))
		if desc := strings.TrimSpace(item.Description); desc != "" {
			builder.WriteString("Summary: ")
			builder.WriteString(desc)
			builder.WriteString("\n")
		}
		builder.WriteString("\n")
	}

	return truncate(builder.String(), 2_048), "done"
}
