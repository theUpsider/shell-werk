package llm

import (
	"context"
	"strings"
)

// ContinuationRequest describes why the dialogue loop is pausing for user input.
type ContinuationRequest struct {
    Reason       string `json:"reason"`
    Iteration    int    `json:"iteration,omitempty"`
    Limit        int    `json:"limit,omitempty"`
    FailureCount int    `json:"failureCount,omitempty"`
    FailureLimit int    `json:"failureLimit,omitempty"`
    ToolName     string `json:"toolName,omitempty"`
    Detail       string `json:"detail,omitempty"`
}

// ContinuationDecision captures how the user wants to proceed.
type ContinuationDecision string

const (
    ContinuationDecisionContinue ContinuationDecision = "continue"
    ContinuationDecisionCancel    ContinuationDecision = "cancel"
)

// ContinuationPrompter requests user confirmation before continuing a long or failing loop.
type ContinuationPrompter interface {
    RequestContinuation(ctx context.Context, sessionID string, req ContinuationRequest) (ContinuationDecision, error)
}

// ContinuationDecisionRequest carries the frontend response back to the backend.
type ContinuationDecisionRequest struct {
    SessionID string `json:"sessionId"`
    RequestID string `json:"requestId"`
    Decision  string `json:"decision"`
}

type autoContinuePrompter struct{}

func (autoContinuePrompter) RequestContinuation(ctx context.Context, sessionID string, req ContinuationRequest) (ContinuationDecision, error) {
    return ContinuationDecisionContinue, nil
}

// ParseContinuationDecision normalizes user-provided decisions.
func ParseContinuationDecision(decision string) (ContinuationDecision, bool) {
    switch strings.ToLower(strings.TrimSpace(decision)) {
    case "continue", "yes", "y", "ok":
        return ContinuationDecisionContinue, true
    case "cancel", "stop", "no":
        return ContinuationDecisionCancel, true
    default:
        return "", false
    }
}
