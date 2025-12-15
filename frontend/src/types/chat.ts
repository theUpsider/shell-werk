export type Role = "user" | "assistant" | "tool";

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id?: string;
  type: string;
  function: ToolCallFunction;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  toolCalls?: ToolCall[];
  isPlaceholder?: boolean;
  isTrace?: boolean;
  traceKind?: string;
  traceTitle?: string;
  traceStatus?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  toolChoices: Record<string, boolean>;
}

export interface DialogueTrace {
  id: string;
  role: string;
  kind: string;
  title?: string;
  content: string;
  status?: string;
  createdAt?: string;
}

export interface ChatResponsePayload {
  message: { role: string; content: string; tool_calls?: ToolCall[] };
  latencyMs: number;
  trace?: DialogueTrace[];
}

export interface ToolMetadata {
  id: string;
  name: string;
  description: string;
  uiVisible: boolean;
  enabled: boolean;
}

export type FeedItem =
  | { kind: "message"; message: ChatMessage }
  | { kind: "trace-group"; id: string; traces: ChatMessage[] };

export interface ThinkingState {
  sessionId: string;
  startedAt: number;
}
