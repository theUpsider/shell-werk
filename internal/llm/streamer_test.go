package llm

import (
	"strings"
	"testing"
)

type mockSink struct {
    think []string
    answer []string
}

func (m *mockSink) ThinkingStart(sessionID string)            {}
func (m *mockSink) ThinkingUpdate(_ string, chunk string) { m.think = append(m.think, chunk) }
func (m *mockSink) ThinkingEnd(sessionID string)              {}
func (m *mockSink) AnswerUpdate(_ string, chunk string)   { m.answer = append(m.answer, chunk) }

func TestOllamaThinkingChunkHandled(t *testing.T) {
    sink := &mockSink{}
    streamer := &Streamer{sink: sink}
    state := streamingState{sink: sink, sessionID: "s1", final: &strings.Builder{}}
    role := ""
    var toolCalls []ToolCall

    chunk := `{"model":"qwen3:4b","message":{"role":"assistant","thinking":" testing"},"done":false}`
    handled, err := streamer.tryOllamaChunk(chunk, &state, &role, &toolCalls)
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if !handled {
        t.Fatalf("expected chunk to be handled")
    }
    if len(sink.think) == 0 || strings.TrimSpace(sink.think[0]) != "testing" {
        t.Fatalf("expected thinking to be captured, got %+v", sink.think)
    }
}
