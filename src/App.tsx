import { FormEvent, useEffect, useRef, useState } from "react";
import "./App.css";

type ChatMessage = {
  id: string;
  sender: "user" | "system";
  text: string;
};

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-1",
      sender: "system",
      text: "Welcome! Ask me anything and I will respond.",
    },
    {
      id: "welcome-2",
      sender: "user",
      text: "Let’s get started.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;

    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sender: "user",
      text: next,
    };

    setMessages((prev) => [...prev, newMessage]);
    setDraft("");
  };

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <div className="chat-title">Shell Werk</div>
        <div className="chat-subtitle">Your conversational workspace</div>
      </header>

      <section
        className="chat-window"
        ref={scrollRef}
        aria-label="Chat history"
      >
        {messages.map((message) => (
          <article
            key={message.id}
            className={`message ${
              message.sender === "user" ? "message-out" : "message-in"
            }`}
          >
            <div className="message-meta">
              {message.sender === "user" ? "You" : "Assistant"}
            </div>
            <div className="message-bubble">{message.text}</div>
          </article>
        ))}
      </section>

      <form className="chat-input-bar" onSubmit={handleSubmit}>
        <input
          className="chat-input"
          placeholder="Type your message..."
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          aria-label="Message input"
        />
        <button className="chat-send" type="submit">
          Send
        </button>
      </form>
    </main>
  );
}

export default App;
