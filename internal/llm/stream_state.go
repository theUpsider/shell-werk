package llm

import (
	"errors"
	"strings"
)

var errStreamDone = errors.New("stream done")

type streamingChunk struct {
	Choices []streamingChoice `json:"choices"`
	Error   struct {
		Message string `json:"message"`
	} `json:"error"`
}

type ollamaStreamChunk struct {
	Model   string              `json:"model"`
	Message ollamaStreamMessage `json:"message"`
	Done    bool                `json:"done"`
	Error   string              `json:"error"`
}

type ollamaStreamMessage struct {
	Role      string                 `json:"role"`
	Content   string                 `json:"content"`
	ToolCalls []ollamaStreamToolCall `json:"tool_calls,omitempty"`
}

type ollamaStreamToolCall struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	} `json:"function"`
}

type streamingChoice struct {
	Delta   streamingDelta   `json:"delta"`
	Message streamingMessage `json:"message"`
}

type streamingDelta struct {
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	ToolCalls []chatToolCall `json:"tool_calls,omitempty"`
}

type streamingMessage struct {
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	ToolCalls []chatToolCall `json:"tool_calls,omitempty"`
}

type streamingState struct {
	sink       StreamEventSink
	sessionID  string
	final      *strings.Builder
	inThinking bool
}

func (s *streamingState) consume(content string) {
	if content == "" {
		return
	}
	lower := strings.ToLower(content)
	pos := 0
	startTag := "<think>"
	endTag := "</think>"

	for pos < len(content) {
		if s.inThinking {
			remaining := lower[pos:]
			endIdx := strings.Index(remaining, endTag)
			if endIdx == -1 {
				s.emitThinking(content[pos:])
				return
			}
			s.emitThinking(content[pos : pos+endIdx])
			s.inThinking = false
			s.sink.ThinkingEnd(s.sessionID)
			pos += endIdx + len(endTag)
			continue
		}

		remaining := lower[pos:]
		startIdx := strings.Index(remaining, startTag)
		if startIdx == -1 {
			s.emitAnswer(content[pos:])
			return
		}
		if startIdx > 0 {
			s.emitAnswer(content[pos : pos+startIdx])
		}
		pos += startIdx + len(startTag)
		s.inThinking = true
	}
}

func (s *streamingState) emitAnswer(chunk string) {
	if chunk == "" {
		return
	}
	s.final.WriteString(chunk)
	s.sink.AnswerUpdate(s.sessionID, chunk)
}

func (s *streamingState) emitThinking(chunk string) {
	if chunk == "" {
		return
	}
	s.sink.ThinkingUpdate(s.sessionID, chunk)
}
