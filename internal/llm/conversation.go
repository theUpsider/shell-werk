package llm

import "strings"

// ConversationFromRequest merges prior user/assistant turns with the latest user
// message, ignoring tool/system entries to keep provider payloads valid.
func ConversationFromRequest(req ChatRequest) []ChatMessage {
	history := NormalizeHistory(req.History)

	if text := strings.TrimSpace(req.Message); text != "" {
		history = append(history, ChatMessage{Role: "user", Content: text})
	}

	return history
}

// NormalizeHistory filters out empty content and non-dialogue roles. It preserves
// chronological order for the model while avoiding placeholder messages.
func NormalizeHistory(history []ChatMessage) []ChatMessage {
	cleaned := make([]ChatMessage, 0, len(history))
	for _, msg := range history {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(msg.Content)
		if content == "" {
			continue
		}
		cleaned = append(cleaned, ChatMessage{Role: role, Content: content})
	}
	return cleaned
}
