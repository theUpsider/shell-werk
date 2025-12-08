package llm

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
	"strings"
	"time"

	"shell-werk/internal/shell"
	"shell-werk/internal/tools"
)

const braveSearchEndpointDefault = "https://api.search.brave.com/res/v1/web/search"

type dialogueLoop struct {
	provider          string
	endpoint          string
	apiKey            string
	model             string
	tools             []string
	toolDefs          []tools.ToolDefinition
	client            *http.Client
	webSearchAPIKey   string
	webSearchEndpoint string
}

func NewDialogueLoop(req ChatRequest) *dialogueLoop {
	webSearchEndpoint := braveSearchEndpointDefault
	if trimmed := strings.TrimSpace(req.WebSearchEndpoint); trimmed != "" {
		webSearchEndpoint = trimmed
	}

	return &dialogueLoop{
		provider:          strings.ToLower(req.Provider),
		endpoint:          req.Endpoint,
		apiKey:            req.APIKey,
		model:             req.Model,
		tools:             req.Tools,
		toolDefs:          req.ToolDefs,
		client:            MakeClient(),
		webSearchAPIKey:   strings.TrimSpace(req.WebSearchAPIKey),
		webSearchEndpoint: webSearchEndpoint,
	}
}

func (l *dialogueLoop) Run(ctx context.Context, req ChatRequest) (ChatMessage, []DialogueTrace, error) {
	trace := []DialogueTrace{}
	start := time.Now()

	toolDefs := l.toolDefs
	messages := []chatCompletionMessage{
		{Role: "system", Content: l.systemPrompt()},
	}

	for _, msg := range ConversationFromRequest(req) {
		messages = append(messages, chatCompletionMessage{Role: msg.Role, Content: msg.Content})
	}

	// Allow up to 12 tool iterations per request to avoid runaway loops.
	for iteration := 0; iteration < 12; iteration++ {
		choice, err := l.requestCompletion(ctx, messages, toolDefs)
		if err != nil {
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "assistant",
				Kind:      "error",
				Status:    "failed",
				Content:   err.Error(),
				CreatedAt: time.Now(),
			})
			return ChatMessage{Role: "assistant", Content: fmt.Sprintf("Dialog failed: %s", err.Error())}, trace, err
		}

		assistantMsg := chatCompletionMessage{
			Role:      choice.Message.Role,
			Content:   choice.Message.Content,
			ToolCalls: choice.Message.ToolCalls,
		}
		messages = append(messages, assistantMsg)

		if len(choice.Message.ToolCalls) == 0 {
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "assistant",
				Kind:      "final",
				Status:    "complete",
				Content:   assistantMsg.Content,
				CreatedAt: time.Now(),
			})
			return ChatMessage{Role: assistantMsg.Role, Content: assistantMsg.Content}, trace, nil
		}

		for _, tc := range choice.Message.ToolCalls {
			argsMap, parseErr := parseArguments(tc.Function.Arguments)
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "tool",
				Kind:      "tool_call",
				Title:     tc.Function.Name,
				Status:    "running",
				Content:   fmt.Sprintf("Calling %s with %s", tc.Function.Name, truncate(tc.Function.Arguments, 320)),
				CreatedAt: time.Now(),
			})

			if tc.Function.Name == "request_fullfilled" {
				summary := contentFromRequestFulfilled(argsMap, assistantMsg.Content)
				trace = append(trace, DialogueTrace{
					ID:        newTraceID(),
					Role:      "assistant",
					Kind:      "final",
					Status:    "complete",
					Content:   summary,
					CreatedAt: time.Now(),
				})
				return ChatMessage{Role: "assistant", Content: summary}, trace, nil
			}

			if parseErr != nil {
				trace = append(trace, DialogueTrace{
					ID:        newTraceID(),
					Role:      "tool",
					Kind:      "tool_result",
					Title:     tc.Function.Name,
					Status:    "error",
					Content:   fmt.Sprintf("invalid arguments: %v", parseErr),
					CreatedAt: time.Now(),
				})
				continue
			}

			result, status := l.executeTool(ctx, tc.Function.Name, argsMap)
			trace = append(trace, DialogueTrace{
				ID:        newTraceID(),
				Role:      "tool",
				Kind:      "tool_result",
				Title:     tc.Function.Name,
				Status:    status,
				Content:   result,
				CreatedAt: time.Now(),
			})

			messages = append(messages, chatCompletionMessage{
				Role:       "tool",
				Name:       tc.Function.Name,
				Content:    result,
				ToolCallID: tc.ID,
			})
		}
	}

	trace = append(trace, DialogueTrace{
		ID:        newTraceID(),
		Role:      "assistant",
		Kind:      "timeout",
		Status:    "timeout",
		Content:   "Loop ended after 12 iterations without request_fullfilled.",
		CreatedAt: time.Now(),
	})

	elapsed := time.Since(start).Round(time.Second)
	return ChatMessage{Role: "assistant", Content: fmt.Sprintf("Request stopped after %s without completion.", elapsed)}, trace, errors.New("dialogue loop exceeded iteration limit")
}

func (l *dialogueLoop) requestCompletion(ctx context.Context, messages []chatCompletionMessage, tools []tools.ToolDefinition) (completionChoice, error) {
	payload := completionRequest{
		Model:       l.model,
		Messages:    messages,
		Stream:      false,
		Tools:       tools,
		Temperature: 0,
	}

	// Avoid sending tool_choice when no tools are available; vLLM rejects that with 400.
	if len(tools) > 0 {
		payload.ToolChoice = "auto"
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return completionChoice{}, err
	}

	url := l.completionsURL()
	log.Printf("[%s] Sending dialogue completion request to %s with model %s", time.Now().Format(time.RFC3339), url, l.model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return completionChoice{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(l.apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+l.apiKey)
	}

	resp, err := l.client.Do(req)
	if err != nil {
		return completionChoice{}, fmt.Errorf("%s completion request failed: %w", strings.ToUpper(l.provider), err)
	}
	defer resp.Body.Close()
	log.Printf("[%s] Received dialogue completion response", time.Now().Format(time.RFC3339))

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return completionChoice{}, fmt.Errorf("%s completion read failed: %w", strings.ToUpper(l.provider), err)
	}

	if resp.StatusCode >= http.StatusBadRequest {
		detail := strings.TrimSpace(string(rawBody))
		if detail == "" {
			detail = resp.Status
		}
		return completionChoice{}, fmt.Errorf("%s completion returned %s: %s", strings.ToUpper(l.provider), resp.Status, truncate(detail, 512))
	}

	var decoded completionResponse
	if err := json.Unmarshal(rawBody, &decoded); err != nil {
		return completionChoice{}, fmt.Errorf("%s completion decode failed: %w", strings.ToUpper(l.provider), err)
	}

	if decoded.Error.Message != "" {
		return completionChoice{}, fmt.Errorf("%s completion error: %s", strings.ToUpper(l.provider), decoded.Error.Message)
	}
	if len(decoded.Choices) == 0 {
		return completionChoice{}, errors.New("no choices returned from provider")
	}

	return decoded.Choices[0], nil
}

func (l *dialogueLoop) executeTool(ctx context.Context, name string, args map[string]any) (string, string) {
	switch name {
	case "browser":
		return l.browserTool(ctx, args)
	case "shell":
		return l.shellTool(ctx, args)
	case "web_search":
		return l.webSearchTool(ctx, args)
	default:
		return fmt.Sprintf("tool %s is not implemented", name), "error"
	}
}

func (l *dialogueLoop) browserTool(ctx context.Context, args map[string]any) (string, string) {
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

	resp, err := l.client.Do(req)
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

func (l *dialogueLoop) shellTool(ctx context.Context, args map[string]any) (string, string) {
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

	executor := shell.NewExecutor()
	output, err := executor.Execute(ctx, cmdName, cmdArgs)
	if err != nil {
		return fmt.Sprintf("Validation error: %v", err), "error"
	}

	if output == "" {
		output = "(command completed with no output)"
	}
	return truncate(output, 2_048), "done"
}

func (l *dialogueLoop) webSearchTool(ctx context.Context, args map[string]any) (string, string) {
	query, _ := args["query"].(string)
	if strings.TrimSpace(query) == "" {
		return "missing query", "error"
	}

	if l.webSearchAPIKey == "" {
		return "Brave Search API key is not set. Add it in Settings before using web search.", "error"
	}

	count := 3
	if val, ok := args["count"].(float64); ok {
		if parsed := int(val); parsed >= 1 && parsed <= 20 {
			count = parsed
		}
	}

	searchURL := l.webSearchEndpoint
	if strings.TrimSpace(searchURL) == "" {
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
	req.Header.Set("X-Subscription-Token", l.webSearchAPIKey)

	resp, err := l.client.Do(req)
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

func (l *dialogueLoop) completionsURL() string {
	base := NormalizeBase(l.endpoint)
	switch l.provider {
	case "ollama":
		return base + "/api/chat"
	default:
		return base + "/v1/chat/completions"
	}
}

func (l *dialogueLoop) systemPrompt() string {
	hostOS := runtime.GOOS
	shellHint := "Shell tool executes commands directly without a wrapping shell; prefer POSIX-friendly commands and paths."
	if hostOS == "windows" {
		shellHint = "Shell tool uses PowerShell; prefer PowerShell-friendly commands and paths."
	}

	return fmt.Sprintf("You are shell-werk. Host OS: %s. %s When tools are present, use them. When the user request is satisfied, call the tool request_fullfilled with a concise summary.", hostOS, shellHint)
}
