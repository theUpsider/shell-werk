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
)

type thinkingEvent struct {
	SessionID string `json:"sessionId"`
	Chunk     string `json:"chunk,omitempty"`
}

type answerEvent struct {
	SessionID string `json:"sessionId"`
	Chunk     string `json:"chunk"`
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
