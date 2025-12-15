package main

import (
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	thinkingStartEvent  = "thinking:start"
	thinkingUpdateEvent = "thinking:update"
	thinkingEndEvent    = "thinking:end"
	answerUpdateEvent   = "answer:update"
	continuationRequestEvent  = "dialogue:continuation_request"
	continuationResolvedEvent = "dialogue:continuation_resolved"
)

type thinkingEvent struct {
	SessionID string `json:"sessionId"`
	Chunk     string `json:"chunk,omitempty"`
}

type answerEvent struct {
	SessionID string `json:"sessionId"`
	Chunk     string `json:"chunk"`
}

type continuationRequestPayload struct {
	SessionID    string `json:"sessionId"`
	RequestID    string `json:"requestId"`
	Reason       string `json:"reason"`
	Iteration    int    `json:"iteration,omitempty"`
	Limit        int    `json:"limit,omitempty"`
	FailureCount int    `json:"failureCount,omitempty"`
	FailureLimit int    `json:"failureLimit,omitempty"`
	ToolName     string `json:"toolName,omitempty"`
	Detail       string `json:"detail,omitempty"`
}

type continuationResolvedPayload struct {
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
	Reason    string `json:"reason,omitempty"`
	Decision  string `json:"decision"`
}

// appEventSink bridges streaming events to the Wails event bus.
type appEventSink struct {
	app *App
}

func (e *appEventSink) ThinkingStart(sessionID string) {
	e.emit(thinkingStartEvent, thinkingEvent{SessionID: sessionID})
}

func (e *appEventSink) ThinkingUpdate(sessionID, chunk string) {
	if strings.TrimSpace(chunk) == "" {
		return
	}
	e.emit(thinkingUpdateEvent, thinkingEvent{SessionID: sessionID, Chunk: chunk})
}

func (e *appEventSink) ThinkingEnd(sessionID string) {
	e.emit(thinkingEndEvent, thinkingEvent{SessionID: sessionID})
}

func (e *appEventSink) AnswerUpdate(sessionID, chunk string) {
	if chunk == "" {
		return
	}
	e.emit(answerUpdateEvent, answerEvent{SessionID: sessionID, Chunk: chunk})
}

func (e *appEventSink) emit(name string, payload any) {
	if e.app == nil || e.app.ctx == nil {
		return
	}
	runtime.EventsEmit(e.app.ctx, name, payload)
}
