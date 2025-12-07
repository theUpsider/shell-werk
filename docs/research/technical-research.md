# Technical Research & Implementation Strategy

This document tracks critical technical research questions that must be answered before development begins. The goal is to provide developers with a clear implementation guide, particularly for complex integrations like LLM tool calling and cross-platform shell execution.

We assume:

- Backend: Tauri (Rust)
- Frontend: React + TypeScript
- Local providers: Ollama, vLLM (OpenAI-compatible server)
- Target OS: Linux, Windows

---

## 1. LLM Tool Calling Implementation (Ollama & vLLM)

**Context:** REQ-009, REQ-013  
**Goal:** Establish a unified way to handle tool calling across different providers.

### Findings

#### 1.1 Ollama Tool Calling API

**How does Ollama structure tool definitions in the request?**

- For the native REST API (`/api/chat`), tools are defined on the top-level `tools` field.
- The schema matches the OpenAI “tools / function calling” format: each tool is an object `{ type: "function", function: { name, description, parameters } }`, where `parameters` is a JSON Schema object.:contentReference[oaicite:0]{index=0}
- Example from the official “Streaming responses with tool calling” blog (simplified):

  ```json
  {
    "model": "qwen3",
    "messages": [
      { "role": "user", "content": "What is the weather today in Toronto?" }
    ],
    "stream": true,
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_current_weather",
          "description": "Get the current weather for a location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": { "type": "string" },
              "format": {
                "type": "string",
                "enum": ["celsius", "fahrenheit"]
              }
            },
            "required": ["location", "format"]
          }
        }
      }
    ]
  }
  ```

````

([Ollama][1])

**How does Ollama return tool calls in the response (streaming vs non-streaming)?**

* Ollama’s native `/api/chat` streaming returns NDJSON (one JSON object per line).([Ollama Documentation][2])
* Each streamed chunk looks roughly like:

  ```json
  {
    "model": "qwen3",
    "created_at": "2025-05-27T22:54:58.100509Z",
    "message": {
      "role": "assistant",
      "content": "",
      "tool_calls": [
        {
          "function": {
            "name": "get_current_weather",
            "arguments": {
              "format": "celsius",
              "location": "Toronto"
            }
          }
        }
      ]
    },
    "done": false
  }
  ```

  * Note: `message.tool_calls[].function.arguments` is already parsed as a JSON object (not a JSON string) on the native API.([Ollama][1])
* The final chunk includes `"done": true` plus timing/usage metadata.([Ollama Documentation][2])
* Non-streaming (`"stream": false`) returns a single JSON object with the same `message` shape (including any `tool_calls`).

**Is it fully compatible with the OpenAI Chat Completions `tools` / `tool_calls` schema?**

* Semantics:

  * The **tools** description is effectively the same as OpenAI: functions + JSON Schema params.([Ollama][1])
  * `message.tool_calls[].function.name` and `.arguments` align conceptually with OpenAI’s `tool_calls`.([Ollama][1])
* Differences:

  * Native Ollama uses `message` instead of `choices[0].message`.
  * `arguments` is an object in Ollama native, versus a JSON string in OpenAI’s Chat Completions.([Ollama][1])
  * Some OpenAI fields (e.g., tool call IDs, indices, `finish_reason: "tool_calls"`) are absent from native responses.
* Ollama also exposes an OpenAI-compatible `/v1/chat/completions` endpoint, which follows the OpenAI spec for `tools` and `tool_calls` while ignoring unsupported options.([vLLM][3])
  For now, we should assume “mostly compatible but not guaranteed identical” and test it explicitly for our target version.

#### 1.2 vLLM Tool Calling API

**Does the vLLM version support native tool calling, or do we need prompt templates?**

* vLLM’s OpenAI-compatible server (`vllm serve`) implements the Chat Completions API at `/v1/chat/completions`.([vLLM][3])
* Tool calling is supported by enabling a tool parser:

  ```bash
  vllm serve <model> \
    --enable-auto-tool-choice \
    --tool-call-parser hermes
  ```

([vLLM][4])

* From the client side (Rust or TS), you simply use standard OpenAI-style `tools` and `tool_choice` fields in the Chat Completions request.([vLLM][4])
* You still need a **chat template** configured for the model to support the Chat API, but that is a server concern (CLI `--chat-template` or model’s built-in template).([vLLM][3])

**If using an OpenAI-compatible server, does it strictly follow the `tool_calls` format?**

* vLLM’s examples show the exact OpenAI-style structure:

  * Request: `tools: [{ type: "function", function: { name, description, parameters } }]`.([vLLM][4])
  * Non-stream response: `choices[0].message.tool_calls[0].function.name` and `.arguments` (string).([vLLM][4])
  * Streaming response: `choices[0].delta.tool_calls[0].index` and `...function.arguments` (partial JSON string), plus possible `choices[0].delta.reasoning` for reasoning models.([vLLM][4])

* There are some known deviations: for example, vLLM ignores `parallel_tool_calls` and `user` fields.([vLLM][3])
  But the core `tool_calls` shape matches OpenAI, which is sufficient for unified parsing.

#### 1.3 Unified Parsing Logic

**Can we use a single Rust struct (via `serde`) to deserialize responses from both providers?**

* At the **top level**, Ollama native and OpenAI/vLLM are different:

  * Ollama native streaming: `{ model, created_at, message, done, ... }`.([Ollama][1])
  * OpenAI/vLLM: `{ id, choices: [ { delta/message, finish_reason, ... } ], ... }`.([vLLM][4])

* At the **message / tool-call level**, we can define a single internal representation:

  ```rust
  #[derive(Debug, Deserialize)]
  pub struct ToolCall {
      #[serde(default)]
      pub id: Option<String>,       // OpenAI/vLLM; absent in Ollama native
      #[serde(default)]
      pub r#type: Option<String>,   // "function"
      pub function: FunctionCall,
  }

  #[derive(Debug, Deserialize)]
  pub struct FunctionCall {
      pub name: String,
      #[serde(deserialize_with = "deserialize_arguments")]
      pub arguments: serde_json::Value, // handles both string + object
  }
  ```

  ```rust
  fn deserialize_arguments<'de, D>(deserializer: D) -> Result<serde_json::Value, D::Error>
  where
      D: serde::Deserializer<'de>,
  {
      use serde::de::Error;
      let v = serde_json::Value::deserialize(deserializer)?;
      match v {
          // OpenAI/vLLM: arguments is a JSON string
          serde_json::Value::String(s) => {
              serde_json::from_str(&s).map_err(D::Error::custom)
          }
          // Ollama native: arguments is already an object
          other => Ok(other),
      }
  }
  ```

* Strategy:

  * Define **provider-specific response structs** that only care enough to get to `ToolCall`:

    * `OllamaChatChunk` with `.message: OllamaMessage`.
    * `OpenAIChatChunk` with `.choices[0].delta` or `.choices[0].message`.

  * Immediately map those into a **provider-neutral** `LlmStreamEvent`:

    ```rust
    pub enum LlmStreamEvent {
        ThinkingToken { text: String },
        AnswerToken { text: String },
        ToolCallDelta { call: ToolCall, index: usize },
        Done,
        ProviderRaw(serde_json::Value), // for logging/debug
    }
    ```

  * This way we share one `ToolCall` / `FunctionCall` struct across providers, but keep simple shims for the top-level wrapper differences.

**How do we handle partial JSON parsing when streaming tool calls?**

* OpenAI/vLLM behavior:

  * `choices[0].delta.tool_calls[0].function.arguments` is emitted as **partial JSON fragments** over multiple chunks.([vLLM][4])
  * Typical approach (vLLM example):

    * Maintain a buffer per `(choice_index, tool_call_index)`.
    * On each chunk, append `delta.tool_calls[...].function.arguments` to the current string buffer.
    * After the stream ends, parse the full arguments string as JSON.([vLLM][4])

* Our plan:

  ```rust
  struct InFlightToolCall {
      function_name: Option<String>,
      argument_buf: String,
  }

  struct ToolCallAssembler {
      calls: HashMap<(u32 /*choice*/, u32 /*tool_index*/), InFlightToolCall>,
  }

  impl ToolCallAssembler {
      fn on_delta(&mut self, choice_idx: u32, tool_idx: u32, delta: &ToolCallDelta) {
          let entry = self.calls
              .entry((choice_idx, tool_idx))
              .or_insert_with(|| InFlightToolCall {
                  function_name: None,
                  argument_buf: String::new(),
              });

          if let Some(name) = delta.function_name.as_deref() {
              entry.function_name = Some(name.to_string());
          }
          if let Some(args_fragment) = delta.arguments_fragment.as_deref() {
              entry.argument_buf.push_str(args_fragment);
          }
      }

      fn finalize(self) -> Vec<ToolCall> {
          self.calls
              .into_iter()
              .filter_map(|((_c, _t), inflight)| {
                  let args_json = serde_json::from_str::<serde_json::Value>(&inflight.argument_buf).ok()?;
                  Some(ToolCall {
                      id: None,
                      r#type: Some("function".into()),
                      function: FunctionCall {
                          name: inflight.function_name.unwrap_or_default(),
                          arguments: args_json,
                      },
                  })
              })
              .collect()
      }
  }
  ```

* For **Ollama native**, we can treat each chunk’s `tool_calls` as already complete `arguments` values—no extra buffering beyond collecting them if we want to batch calls.

---

### Implementation Notes (To be filled)

**Implementation Notes**

1. **Provider strategy**

   * For **tool calling**:

     * Use vLLM’s `/v1/chat/completions` (OpenAI-compatible) with `tools` for server-side models.([vLLM][3])
     * Use **native Ollama `/api/chat`** for local models to get:

       * Streaming NDJSON.
       * Native `message.tool_calls` + `message.thinking` support.([Ollama][1])
   * For purely OpenAI-style integrations, we can optionally use Ollama’s OpenAI-compatible endpoint, but we should treat it as “best effort” and have proper integration tests.

2. **Rust types & mapping**

   * Define:

     * `OllamaChatChunk` matching `/api/chat` fields we care about.
     * `OpenAiChatChunk` matching standard Chat Completions.
     * `ToolCall` / `FunctionCall` as provider-neutral internal types (see above).
   * Implement `From<OllamaChatChunk> for Vec<LlmStreamEvent>` and `From<OpenAiChatChunk> for Vec<LlmStreamEvent>` which feed a unified streaming channel to the Tauri / React client.

3. **Streaming pipeline in Tauri**

   * Tauri command (simplified):

     ```rust
     #[tauri::command]
     async fn llm_chat_stream(request: ChatRequest) -> Result<(), String> {
         let provider = select_provider(&request);
         let mut stream = provider.chat_stream(request).await?;
         while let Some(chunk) = stream.next().await {
             let events = map_provider_chunk_to_events(chunk)?;
             for evt in events {
                 app_handle.emit_all("llm-stream", evt)?;
             }
         }
         Ok(())
     }
     ```

   * Frontend subscribes to `"llm-stream"` and updates the UI based on `LlmStreamEvent`.

4. **Partial JSON handling**

   * Implement `ToolCallAssembler` (above) specifically for OpenAI/vLLM streams (Ollama doesn’t need it).
   * If `serde_json::from_str` fails at the end, surface a structured error and also expose the raw `argument_buf` for debugging/logging.

---

## 2. "Thinking" State Visualization

**Context:** REQ-003
**Goal:** Display the internal reasoning process of the model before the final answer.

### Findings

#### 2.1 Ollama Streaming Format (Thinking)

**Does Ollama emit specific tokens / fields for “thinking”?**

* Yes. “Thinking-capable” models (e.g., Qwen 3, DeepSeek R1, GPT-OSS, etc.) emit a dedicated `thinking` field when you pass `"think": true` in chat or generate requests.([Ollama Documentation][5])
* For `/api/chat`:

  * Non-stream: the response has `message.thinking` (reasoning trace) and `message.content` (final answer).([Ollama Documentation][5])
  * Stream: chunks interleave `message.thinking` tokens before `message.content` tokens.([Ollama Documentation][5])

**How to differentiate between “thinking” content and final response content in the stream?**

* Official streaming pattern:([Ollama Documentation][5])

  * Start with `in_thinking = false`.
  * For each chunk:

    * If `chunk.message.thinking` is non-empty and `!in_thinking`, begin the thinking section (set `in_thinking = true`).
    * While `chunk.message.thinking` has text, append it to the reasoning buffer.
    * When `chunk.message.content` appears:

      * If `in_thinking` is true, close the “Thinking” section and start the “Answer” section.
      * Append `chunk.message.content` to the answer buffer.

* Example (pseudocode, Rust):

  ```rust
  let mut in_thinking = false;

  match event {
      LlmStreamEvent::ThinkingToken { text } => {
          if !in_thinking {
              ui.begin_thinking_section();
              in_thinking = true;
          }
          ui.append_thinking(text);
      }
      LlmStreamEvent::AnswerToken { text } => {
          if in_thinking {
              ui.end_thinking_section();
              ui.begin_answer_section();
              in_thinking = false;
          }
          ui.append_answer(text);
      }
      _ => {}
  }
  ```

#### 2.2 vLLM Streaming Format (Reasoning)

**How is the reasoning trace exposed in vLLM?**

* vLLM supports “reasoning” models via OpenAI Chat Completions, with a dedicated `reasoning` field.([vLLM][4])
* Non-streamed response:

  * `completion.choices[0].message.reasoning` – the reasoning trace.
  * `completion.choices[0].message.content` – the final answer.([vLLM][4])
* Streamed response:

  * Reasoning tokens are emitted in `choices[0].delta.reasoning`.
  * Normal answer tokens are emitted in `choices[0].delta.content`.
  * Example logic from vLLM docs:

    ```python
    if chunk.choices[0].delta.tool_calls:
        ...
    else:
        if hasattr(chunk.choices[0].delta, "reasoning"):
            reasoning += chunk.choices[0].delta.reasoning
    ```

([vLLM][4])

* This maps naturally to `LlmStreamEvent::ThinkingToken` (from `.delta.reasoning`) and `LlmStreamEvent::AnswerToken` (from `.delta.content`).

#### 2.3 Frontend Handling

**How should the frontend state machine handle `thinking -> collapsing thoughts -> streaming response`?**

Proposed React-side state machine:

* States:

  ```ts
  type ThoughtPhase = "idle" | "thinking" | "collapsing" | "answering" | "done";
  ```

* Transitions:

  * `idle` → `thinking` on first `ThinkingToken`.
  * `thinking` → `collapsing` when the first `AnswerToken` or `ToolCallDelta` arrives.
  * `collapsing` → `answering` after a short UX-driven delay (e.g., 200–400ms) to animate the collapse of the reasoning panel.
  * `answering` → `done` on `Done` event.

* Implementation sketch (React + Tauri events):

  ```ts
  type LlmStreamEvent =
    | { type: "thinking"; text: string }
    | { type: "answer"; text: string }
    | { type: "tool_call"; call: ToolCall }
    | { type: "done" };

  function useLlmStream() {
    const [phase, setPhase] = useState<ThoughtPhase>("idle");
    const [thinkingText, setThinkingText] = useState("");
    const [answerText, setAnswerText] = useState("");

    useEffect(() => {
      const unlisten = window.__TAURI__.event.listen<LlmStreamEvent>(
        "llm-stream",
        ({ payload }) => {
          switch (payload.type) {
            case "thinking":
              if (phase === "idle") setPhase("thinking");
              setThinkingText((t) => t + payload.text);
              break;
            case "answer":
            case "tool_call":
              if (phase === "thinking") {
                setPhase("collapsing");
                // After animation, move to answering
                setTimeout(() => setPhase("answering"), 250);
              }
              if (payload.type === "answer") {
                setAnswerText((t) => t + payload.text);
              }
              break;
            case "done":
              setPhase((p) => (p === "idle" ? "done" : p));
              break;
          }
        }
      );
      return () => { unlisten.then((f) => f()); };
    }, [phase]);

    return { phase, thinkingText, answerText };
  }
  ```

* UX recommendation:

  * Show “Thinking…” with live updating tokens.
  * On transition to `collapsing`, shrink the thinking section into a small, scrollable panel or a toggle (“Show reasoning”).
  * For security/privacy, include a global setting allowing users to hide reasoning by default.

---

### Implementation Notes (To be filled)

**Implementation Notes**

* For **Ollama**:

  * Always pass `"think": true` for supported models when in “debug” mode; allow disabling in app settings.([Ollama Documentation][5])
  * Map `chunk.message.thinking` → `LlmStreamEvent::ThinkingToken`.
  * Map `chunk.message.content` → `LlmStreamEvent::AnswerToken`.

* For **vLLM**:

  * Expose an option to enable reasoning models and reasoning parsers on the server (`--reasoning-parser <parser>` for models like QwQ).([vLLM][4])
  * Map `choices[].delta.reasoning` → `ThinkingToken`, `choices[].delta.content` → `AnswerToken`.

* **Frontend**:

  * Implement a single stream listener and render:

    * A “Thinking” panel (collapsible).
    * The main answer panel.
  * Persist the full reasoning text in logs for debugging (behind a config flag).

---

## 3. Safe Shell Execution & Sanitization

**Context:** REQ-005
**Goal:** Prevent malicious command execution while allowing legitimate user tasks.

### Findings

#### 3.1 Cross-Platform Sanitization (Rust / Tauri)

**Rust libraries for parsing and sanitizing shell commands**

* `shlex` crate:

  * Parses strings into tokens using POSIX shell rules, similar to Python’s `shlex`.([Docs.rs][6])
  * Good for turning a user-facing string (e.g., `"git status -sb"`) into `[ "git", "status", "-sb" ]` without actually invoking a shell.

* `shell_escape` crate:

  * Provides portable escaping for shell arguments, with Unix- and Windows-specific modules.([Docs.rs][7])
  * Useful only when we *must* construct a command string for a real shell (`sh -c` or `powershell -Command`), which we should avoid for untrusted input.

* `xshell` crate:

  * Provides a cross-platform command “scripting” API built on `std::process::Command`, re-implementing many shell features safely in Rust.([Docs.rs][8])

* Tauri shell plugin:

  * `tauri-plugin-shell` exposes a constrained shell API with an allowlist and per-command scopes, designed with a multi-layered security model.([DeepWiki][9])
  * This aligns well with our security goals; we can either:

    * Use the plugin directly (frontend -> plugin).
    * Or mirror its ideas in our own Rust backend commands.

**Safe argument handling for PowerShell vs Bash/Zsh**

* Best practice (Rust/Tauri):

  * **Do not** pass user-controlled text to `sh -c` or `powershell -Command` as a single string.

  * Instead, use `std::process::Command` (or Tauri’s equivalent) with **program + args**:

    ```rust
    let mut cmd = Command::new("git");
    cmd.arg("status").arg("--short");
    ```

  * This treats special characters (`&`, `|`, `;`, `>` etc.) as literal arguments rather than shell syntax.([Rust Internals][10])

* If we must call a real shell for some fixed functionality:

  * Only for **static, non-user-controlled templates** (e.g., built-in `list_dir` command).
  * Escape dynamic pieces with `shell_escape::unix::escape` or `shell_escape::windows::escape`.([Docs.rs][7])

#### 3.2 Validation Logic

**Whitelist / blacklist strategy**

* Whitelist (preferred):

  * Define a closed set of allowed binaries by OS, e.g.:

    ```rust
    enum AllowedProgram {
        Git,
        Node,
        Npm,
        Cargo,
        Python,
        // ...
    }
    ```

  * Map from a string requested by the LLM to an `AllowedProgram`, rejecting anything else.

* Extra rules:

  * Disallow `sudo`, `su`, `powershell.exe` (if we don’t explicitly want it), `cmd.exe`, `reg`, disk utilities, etc.
  * Restrict filesystem writes:

    * For destructive commands (e.g., `rm`, `del`), either disallow completely or restrict paths to an app-specific workspace directory.
  * Use “capabilities” per command:

    * E.g., for `git`, only allow read-only commands (`status`, `log`, `diff`) from the agent.

**Detecting chained commands (`;`, `&&`, `|`, etc.)**

* If we parse the user string with `shlex::split`, we can simply reject any token equal to:

  * `";"`, `"&&"`, `"||"`, `"|"`, `">"`, `">>"`, `"<"`.
  * Also check for suspicious patterns like `$(`, `$(...)`, backticks.

  ```rust
  fn contains_shell_control(tokens: &[String]) -> bool {
      static DANGEROUS: &[&str] = &[";", "&&", "||", "|", ">", ">>", "<"];
      tokens.iter().any(|t| DANGEROUS.contains(&t.as_str()))
  }
  ```

* Even though `Command::new` would treat these as ordinary args, banning them avoids patterns like trying to trick our own wrappers or external tools that evaluate strings.

* On Windows, we also avoid constructing a combined `cmd /C "<user>"` or `powershell -Command "<user>"` string to prevent injection via the very permissive command-line parsing.([The Rust Programming Language Forum][11])

---

### Implementation Notes (To be filled)

**Implementation Notes**

1. **Tauri command design**

   * Expose a single Rust command that the LLM tool calls, e.g.:

     ```rust
     #[derive(Deserialize)]
     struct ShellCommandRequest {
         program: String,
         args: Vec<String>,
         cwd: Option<String>,
     }
     ```

     ```rust
     #[tauri::command]
     async fn run_shell_command(req: ShellCommandRequest) -> Result<CommandResult, String> {
         let program = map_to_allowed_program(&req.program)
             .ok_or_else(|| "Program not allowed".to_string())?;

         // Token-level checks (e.g., from an optional command-line string).
         if contains_shell_control(&req.args) {
             return Err("Chained shell operators are not allowed".into());
         }

         let mut cmd = std::process::Command::new(program.binary_name());
         cmd.args(&req.args);

         if let Some(cwd) = &req.cwd {
             cmd.current_dir(cwd);
         }

         let output = cmd.output().map_err(|e| e.to_string())?;

         Ok(CommandResult {
             stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
             stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
             status: output.status.code(),
         })
     }
     ```

2. **LLM tool schema for shell execution**

   * Define a tool in the LLM layer that **does not accept raw shell strings**, only structured parameters:

     ```json
     {
       "type": "function",
       "function": {
         "name": "run_command",
         "description": "Execute a safe, whitelisted system command",
         "parameters": {
           "type": "object",
           "properties": {
             "program": { "type": "string" },
             "args": { "type": "array", "items": { "type": "string" } },
             "cwd": { "type": "string", "nullable": true }
           },
           "required": ["program", "args"]
         }
       }
     }
     ```

   * We validate `program` and `args` as above before executing.

3. **OS constraints**

   * Normalise behaviour across Linux and Windows by:

     * Avoiding shell-specific features.
     * Using `std::process::Command` everywhere.
   * For commands that are inherently shell-specific (e.g., `dir`), create app-level adapters:

     * e.g., `list_directory` → internally runs `ls` on Linux, `cmd /C dir` with a *static* template on Windows.

4. **Audit logging**

   * Log all executed commands, including:

     * Provider that requested the tool call.
     * Normalised `program` + `args`.
     * Exit status and truncated stdout/stderr.
   * Use logs for post-hoc security review and tuning the allowlist.

---

## 4. E2E Testing Infrastructure

**Context:** REQ-007, REQ-008
**Goal:** Reliable CI/CD pipeline with local LLM integration.

### Findings

#### 4.1 GitHub Actions Caching for Ollama Models

**How do we cache the `qwen3:4b` Ollama model blob to prevent massive downloads on every CI run?**

* Default model paths:

  * On many Linux installs, Ollama stores models under `/usr/share/ollama/.ollama/models` or `/var/lib/ollama/.ollama/models`.([GitHub][12])
  * On single-user setups, models commonly reside in `~/.ollama/models`.([Stack Overflow][13])
  * On Windows, default path is `C:\Users\<user>\.ollama\models`.([igoroseledko.com][14])
* Official docs recommend using the `OLLAMA_MODELS` environment variable to override the models directory.([Ollama Documentation][15])

**Recommended CI caching strategy**

* In GitHub Actions, do:

  * Set `OLLAMA_MODELS` to a directory inside the workspace or runner temp dir (so it’s cacheable):

    ```yaml
    env:
      OLLAMA_MODELS: ${{ runner.temp }}/ollama-models
    ```

  * Use `actions/cache@v4` to persist that directory keyed by model + OS:

    ```yaml
    - name: Cache Ollama models
      uses: actions/cache@v4
      with:
        path: ${{ env.OLLAMA_MODELS }}
        key: ollama-models-qwen3-4b-${{ runner.os }}-v1
    ```

  * After installing Ollama, run:

    ```yaml
    - name: Pull qwen3:4b model
      run: |
        ollama pull qwen3:4b
    ```

    If the cache was restored, this is mostly a no-op and just verifies integrity.

#### 4.2 Service Orchestration

**How do we ensure Ollama is fully up and the model is loaded before Playwright tests?**

* Basic pattern from a proven GitHub Actions answer: install Ollama, start `ollama serve` in the background, pull a model, then call the API.([Stack Overflow][16])

* Robust workflow sketch:

  ```yaml
  name: e2e-tests

  on:
    push:
    pull_request:

  jobs:
    e2e:
      runs-on: ubuntu-latest

      env:
        OLLAMA_MODELS: ${{ runner.temp }}/ollama-models

      steps:
        - uses: actions/checkout@v4

        - name: Cache Ollama models
          uses: actions/cache@v4
          with:
            path: ${{ env.OLLAMA_MODELS }}
            key: ollama-models-qwen3-4b-${{ runner.os }}-v1

        - name: Install Ollama
          run: curl -fsSL https://ollama.com/install.sh | sh

        - name: Start Ollama server
          run: |
            ollama serve > ollama.log 2>&1 &
            # Wait for the HTTP endpoint to be ready
            for i in {1..30}; do
              if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
                echo "Ollama is up"; break
              fi
              echo "Waiting for Ollama..."
              sleep 2
            done

        - name: Pull qwen3:4b
          run: |
            ollama pull qwen3:4b

        - name: Warm up model
          run: |
            curl -s -X POST http://localhost:11434/api/generate \
              -d '{"model":"qwen3:4b","prompt":"ping","stream":false}' \
              | jq .

        - name: Install Node deps
          run: npm ci

        - name: Run Playwright tests
          run: npx playwright test
  ```

* Notes:

  * The `Warm up model` step ensures `qwen3:4b` is loaded into memory before tests, reducing first-test latency.
  * You can further tune `OLLAMA_KEEP_ALIVE` server-side or via `keep_alive` request params to keep the model loaded longer.

**Service container vs background step**

* Using a Docker service container is possible via the official `ollama/ollama` image, but:

  * It adds more moving parts (Docker-in-Docker, port mapping).
  * For CI with Playwright, the simpler approach is:

    * Install Ollama via `install.sh` on `ubuntu-latest`.
    * Start `ollama serve &` in a background step as shown above.

---

### Implementation Notes (To be filled)

**Implementation Notes**

* Add an E2E test helper in Node that checks connectivity before starting tests:

  ```ts
  import http from "http";

  export async function waitForOllama(timeoutMs = 60_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await new Promise<void>((resolve, reject) => {
          const req = http.get("http://localhost:11434/api/tags", (res) => {
            res.resume();
            res.statusCode === 200 ? resolve() : reject();
          });
          req.on("error", reject);
        });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error("Ollama did not become ready in time");
  }
  ```

* In Playwright’s `globalSetup`, call `waitForOllama()` once to fail fast if Ollama is unreachable.

* Later we can add an equivalent path for vLLM (probably in a separate job that starts `vllm serve` in the background and waits on its port).

---

## 5. Provider Abstraction Layer

**Context:** REQ-009
**Goal:** Switch between providers without changing application logic.

### Findings

#### 5.1 Client Libraries

**Is there a robust Rust crate that supports generic base URLs and custom headers?**

* `async-openai` (Rust):

  * Mature crate for OpenAI APIs that also supports “OpenAI-compatible” providers by customising the base URL and config.

  * `OpenAIConfig::with_api_base` lets you override the API base URL, e.g.:

    ```rust
    use async_openai::{Client, config::OpenAIConfig};

    let config = OpenAIConfig::new()
        .with_api_key("EMPTY")
        .with_api_base("http://localhost:8000/v1"); // vLLM
    let client = Client::with_config(config);
    ```

    for vLLM, or

    ```rust
    .with_api_base("http://localhost:11434/v1"); // Ollama OpenAI-compatible
    ```

    for Ollama.

  * The crate exposes a `Config` trait, allowing multiple providers with different bases and headers to be used via dynamic dispatch.

* TypeScript / React side:

  * Official `openai` TS client supports custom `baseURL` as well:

    ```ts
    import OpenAI from "openai";

    const client = new OpenAI({
      baseURL: "http://localhost:8000/v1", // vLLM
      apiKey: "EMPTY",
    });
    ```

  * However, in a Tauri app, it’s usually cleaner to keep network I/O in the Rust backend and expose a unified Tauri command to the frontend, instead of making HTTP calls directly from the webview.

#### 5.2 Trait Design: `LLMProvider`

**Do we need a custom trait to handle subtle API differences?**

Yes. Even with OpenAI-compatible APIs, we have differences:

* Ollama native vs OpenAI shape.
* Thinking support (`thinking` vs `reasoning`).
* Tool calling streaming details.

Define a Rust trait that describes a generic provider:

```rust
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    fn name(&self) -> &'static str;

    async fn chat_stream(
        &self,
        request: ChatRequest,
    ) -> anyhow::Result<BoxStream<'static, LlmStreamEvent>>;

    async fn chat_once(
        &self,
        request: ChatRequest,
    ) -> anyhow::Result<ChatResponse>;
}
```

Where:

* `ChatRequest` is our **provider-neutral** request:

  ```rust
  pub struct ChatRequest {
      pub model: String,
      pub messages: Vec<ChatMessage>,
      pub tools: Vec<ToolDefinition>,
      pub tool_choice: Option<ToolChoice>,
      pub enable_thinking: bool,
      pub temperature: Option<f32>,
      // ...
  }
  ```

* `LlmStreamEvent` is the unified stream event enum described earlier.

Concrete implementations:

* `OllamaProvider`:

  * Uses reqwest against `/api/chat`.
  * Converts `ChatRequest` to Ollama’s schema (`messages`, `tools`, `think`, etc.).
  * Maps each NDJSON chunk into `LlmStreamEvent`.

* `VllmProvider`:

  * Uses `async-openai` with a config whose `api_base` points to `http://localhost:8000/v1`.
  * Converts `ChatRequest` into an OpenAI `ChatCompletionRequest`.
  * Handles streaming with tool calls + optional reasoning as per section 1 and 2.

Provider selection:

```rust
pub enum ProviderKind {
    Ollama,
    Vllm,
}

pub struct ProviderRegistry {
    ollama: Arc<dyn LlmProvider>,
    vllm: Arc<dyn LlmProvider>,
}

impl ProviderRegistry {
    pub fn get(&self, kind: ProviderKind) -> Arc<dyn LlmProvider> {
        match kind {
            ProviderKind::Ollama => self.ollama.clone(),
            ProviderKind::Vllm => self.vllm.clone(),
        }
    }
}
```

Tauri command:

```rust
#[tauri::command]
async fn chat_route(
    provider: ProviderKind,
    request: ChatRequest,
    state: tauri::State<'_, ProviderRegistry>,
) -> Result<(), String> {
    let prov = state.get(provider);
    let mut stream = prov.chat_stream(request).await.map_err(|e| e.to_string())?;
    // Emit events as in Section 1
    Ok(())
}
```

---

### Implementation Notes (To be filled)

**Implementation Notes**

* Backend:

  * Implement `OllamaProvider` and `VllmProvider` behind `LlmProvider`.
  * Use `async-openai` only for the OpenAI-compatible side (vLLM, optionally Ollama’s `/v1`).
  * For thinking:

    * `OllamaProvider` sets `think: request.enable_thinking`.
    * `VllmProvider` maps `enable_thinking` into the correct reasoning model/extra params, if available.

* Frontend:

  * Treat the backend as a **single logical provider**:

    * React only knows about `ChatRequest`, `ProviderKind`, and `LlmStreamEvent`.
    * Provider details are hidden in Rust.

* Testing:

  * For unit tests, inject a fake `LlmProvider` that emits deterministic `LlmStreamEvent` sequences.
  * For integration tests, spin up both Ollama and vLLM, then run the same tool-calling tests against both and assert we get equivalent internal `ToolCall` structures.

---

```
::contentReference[oaicite:51]{index=51}
```

[1]: https://ollama.com/blog/streaming-tool "Streaming responses with tool calling · Ollama Blog"
[2]: https://docs.ollama.com/capabilities/streaming "Streaming - Ollama"
[3]: https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html "OpenAI-Compatible Server — vLLM"
[4]: https://docs.vllm.ai/en/stable/examples/online_serving/openai_chat_completion_tool_calls_with_reasoning/ "OpenAI Chat Completion Tool Calls With Reasoning - vLLM"
[5]: https://docs.ollama.com/capabilities/thinking "Thinking - Ollama"
[6]: https://docs.rs/shlex/latest/shlex/ "shlex - Rust"
[7]: https://docs.rs/shell-escape "shell_escape - Rust"
[8]: https://docs.rs/xshell/latest/xshell/?utm_source=chatgpt.com "xshell - Rust - Docs.rs"
[9]: https://deepwiki.com/tauri-apps/tauri-plugin-shell/4-security-and-permissions?utm_source=chatgpt.com "Security & Permissions | tauri-apps/tauri-plugin-shell | DeepWiki"
[10]: https://internals.rust-lang.org/t/std-process-on-windows-is-escaping-raw-literals-which-causes-problems-with-chaining-commands/8163?utm_source=chatgpt.com "Std::process on windows is escaping raw literals which ... - Rust Internals"
[11]: https://users.rust-lang.org/t/std-process-is-escaping-a-raw-string-literal-when-i-dont-want-it-to/19441?utm_source=chatgpt.com "Std::process is escaping a raw string literal when I don't want it to"
[12]: https://github.com/ollama/ollama/issues/1737?utm_source=chatgpt.com "Where is ollama storing models? · Issue #1737 - GitHub"
[13]: https://stackoverflow.com/questions/79444743/how-to-change-where-ollama-models-are-saved-on-linux?utm_source=chatgpt.com "How to change where OLLAMA models are saved on linux"
[14]: https://www.igoroseledko.com/relocating-ollama-models-folder-in-windows/?utm_source=chatgpt.com "Relocating Ollama Models Folder in Windows - Igor Oseledko"
[15]: https://docs.ollama.com/windows?utm_source=chatgpt.com "Windows - Ollama"
[16]: https://stackoverflow.com/questions/78486506/ollama-running-with-github-actions "docker compose - Ollama running with Github actions - Stack Overflow"
````
