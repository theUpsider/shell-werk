use directories::ProjectDirs;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::{env, fs, path::PathBuf, sync::Mutex, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter};

const CONFIG_FILE: &str = "llm-config.json";
const QUALIFIER: &str = "com";
const ORGANIZATION: &str = "theupsider";
const APPLICATION: &str = "shell-werk";
const CONFIG_OVERRIDE_ENV: &str = "SHELL_WERK_LLM_CONFIG_PATH";
const STREAM_EVENT: &str = "llm-stream";

pub type Result<T> = std::result::Result<T, LlmError>;

#[derive(Debug)]
pub enum LlmError {
    Io(std::io::Error),
    Serde(serde_json::Error),
    Http(reqwest::Error),
    Path(String),
    Tool(String),
    MissingProviderConfig(LlmProvider),
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::Io(err) => write!(f, "I/O error: {}", err),
            LlmError::Serde(err) => write!(f, "Invalid configuration: {}", err),
            LlmError::Http(err) => write!(f, "Request failed: {}", err),
            LlmError::Path(msg) => write!(f, "{}", msg),
            LlmError::Tool(msg) => write!(f, "{}", msg),
            LlmError::MissingProviderConfig(provider) => {
                write!(f, "Missing configuration for provider {provider:?}")
            }
        }
    }
}

impl std::error::Error for LlmError {}

impl From<std::io::Error> for LlmError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serde_json::Error> for LlmError {
    fn from(value: serde_json::Error) -> Self {
        Self::Serde(value)
    }
}

impl From<reqwest::Error> for LlmError {
    fn from(value: reqwest::Error) -> Self {
        Self::Http(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: ChatRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueRequest {
    pub history: Vec<ChatMessage>,
    pub input: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamRequest {
    pub history: Vec<ChatMessage>,
    pub input: String,
    pub request_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueResponse {
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Answer { request_id: String, delta: String },
    Done { request_id: String },
    Error { request_id: String, message: String },
}

#[derive(Debug, Clone)]
struct ToolCall {
    id: String,
    name: String,
    arguments: Value,
}

pub struct LlmState {
    store: Mutex<LlmStore>,
}

impl LlmState {
    pub fn initialize() -> Result<Self> {
        let path = resolve_config_path()?;
        let store = LlmStore::load(path)?;
        Ok(Self {
            store: Mutex::new(store),
        })
    }

    pub fn current_config(&self) -> Result<LlmConfiguration> {
        let guard = self.store.lock().expect("llm state poisoned");
        Ok(guard.config.clone())
    }

    pub fn persist_config(&self, next: LlmConfiguration) -> Result<LlmConfiguration> {
        let mut guard = self.store.lock().expect("llm state poisoned");
        guard.replace(next)?;
        Ok(guard.config.clone())
    }

    pub fn update_selected_model(&self, model_id: Option<String>) -> Result<LlmConfiguration> {
        let mut guard = self.store.lock().expect("llm state poisoned");
        guard.config.selected_model = sanitize_optional(model_id);
        guard.persist()?;
        Ok(guard.config.clone())
    }

    pub fn list_models(&self, provider: Option<LlmProvider>) -> Result<Vec<LlmModel>> {
        let (provider_kind, provider_config) = {
            let guard = self.store.lock().expect("llm state poisoned");
            let provider_kind = provider.unwrap_or(guard.config.active_provider);
            let provider_config = guard
                .config
                .providers
                .get(provider_kind)
                .cloned()
                .ok_or(LlmError::MissingProviderConfig(provider_kind))?;
            (provider_kind, provider_config)
        };

        fetch_models(provider_kind, &provider_config)
    }
}

fn resolve_config_path() -> Result<PathBuf> {
    if let Ok(override_path) = env::var(CONFIG_OVERRIDE_ENV) {
        let override_path = PathBuf::from(override_path);
        if override_path.is_dir() {
            return Ok(override_path.join(CONFIG_FILE));
        }
        return Ok(override_path);
    }

    let dirs = ProjectDirs::from(QUALIFIER, ORGANIZATION, APPLICATION)
        .ok_or_else(|| LlmError::Path("Unable to resolve configuration directory".into()))?;

    Ok(dirs.config_dir().join(CONFIG_FILE))
}

struct LlmStore {
    path: PathBuf,
    config: LlmConfiguration,
}

impl LlmStore {
    fn load(path: PathBuf) -> Result<Self> {
        let config = if path.exists() {
            let raw = fs::read_to_string(&path)?;
            serde_json::from_str::<LlmConfiguration>(&raw)?.normalize()
        } else {
            LlmConfiguration::default()
        };

        let store = Self { path, config };
        store.persist()?;
        Ok(store)
    }

    fn replace(&mut self, next: LlmConfiguration) -> Result<()> {
        self.config = next.normalize();
        self.persist()
    }

    fn persist(&self) -> Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }

        let payload = serde_json::to_string_pretty(&self.config)?;
        fs::write(&self.path, payload)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LlmProvider {
    Vllm,
    Ollama,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfiguration {
    pub active_provider: LlmProvider,
    #[serde(default)]
    pub selected_model: Option<String>,
    #[serde(default)]
    pub providers: ProviderCollection,
}

impl Default for LlmConfiguration {
    fn default() -> Self {
        Self {
            active_provider: LlmProvider::Vllm,
            selected_model: None,
            providers: ProviderCollection::default(),
        }
    }
}

impl LlmConfiguration {
    fn normalize(mut self) -> Self {
        self.selected_model = sanitize_optional(self.selected_model);
        self.providers = self.providers.normalize();
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCollection {
    pub vllm: ProviderConnectionConfig,
    pub ollama: ProviderConnectionConfig,
}

impl Default for ProviderCollection {
    fn default() -> Self {
        Self {
            vllm: ProviderConnectionConfig::default_for(LlmProvider::Vllm),
            ollama: ProviderConnectionConfig::default_for(LlmProvider::Ollama),
        }
    }
}

impl ProviderCollection {
    fn normalize(mut self) -> Self {
        self.vllm = self.vllm.normalize(LlmProvider::Vllm);
        self.ollama = self.ollama.normalize(LlmProvider::Ollama);
        self
    }

    fn get(&self, provider: LlmProvider) -> Option<&ProviderConnectionConfig> {
        match provider {
            LlmProvider::Vllm => Some(&self.vllm),
            LlmProvider::Ollama => Some(&self.ollama),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionConfig {
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
}

impl ProviderConnectionConfig {
    fn default_for(provider: LlmProvider) -> Self {
        Self {
            base_url: default_base_url(provider).to_string(),
            api_key: None,
        }
    }

    fn normalize(mut self, provider: LlmProvider) -> Self {
        if self.base_url.trim().is_empty() {
            self.base_url = default_base_url(provider).to_string();
        }

        self.base_url = self.base_url.trim().trim_end_matches('/').to_string();

        self.api_key = sanitize_optional(self.api_key);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModel {
    pub id: String,
    pub label: String,
    pub provider: LlmProvider,
}

fn sanitize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|input| {
        let trimmed = input.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn default_base_url(provider: LlmProvider) -> &'static str {
    match provider {
        LlmProvider::Vllm => "http://127.0.0.1:8000",
        LlmProvider::Ollama => "http://127.0.0.1:11434",
    }
}

pub fn run_dialogue(state: &LlmState, request: DialogueRequest) -> Result<DialogueResponse> {
    let DialogueRequest { history, input } = request;
    let trimmed = input.trim();

    if trimmed.is_empty() {
        return Err(LlmError::Path("Message cannot be empty".into()));
    }

    let config = state.current_config()?;
    let model = config
        .selected_model
        .clone()
        .ok_or_else(|| LlmError::Path("Select a model before chatting".into()))?;

    let provider = config.active_provider;
    let provider_config = config
        .providers
        .get(provider)
        .cloned()
        .ok_or(LlmError::MissingProviderConfig(provider))?;

    let mut conversation = history;
    let mut appended: Vec<ChatMessage> = Vec::new();

    let user_message = ChatMessage {
        id: next_id("user"),
        role: ChatRole::User,
        content: trimmed.to_string(),
        tool_call_id: None,
    };

    conversation.push(user_message);

    let tools = available_tools();
    let mut pending = send_chat_completion(
        provider,
        &provider_config,
        &model,
        &conversation,
        &tools,
    )?;

    let mut iterations = 0u8;

    loop {
        if let Some(content) = pending.content.take() {
            if !content.trim().is_empty() {
                let assistant_message = ChatMessage {
                    id: next_id("assistant"),
                    role: ChatRole::Assistant,
                    content,
                    tool_call_id: None,
                };
                conversation.push(assistant_message.clone());
                appended.push(assistant_message);
            }
        }

        if pending.tool_calls.is_empty() {
            break;
        }

        for call in pending.tool_calls.iter() {
            let result = execute_tool(call)?;
            let tool_message = ChatMessage {
                id: next_id("tool"),
                role: ChatRole::Tool,
                content: result,
                tool_call_id: Some(call.id.clone()),
            };
            conversation.push(tool_message.clone());
            appended.push(tool_message);
        }

        iterations += 1;
        if iterations > 3 {
            break;
        }

        pending = send_chat_completion(
            provider,
            &provider_config,
            &model,
            &conversation,
            &tools,
        )?;
    }

    Ok(DialogueResponse { messages: appended })
}

pub fn run_stream(app: AppHandle, state: &LlmState, request: StreamRequest) -> Result<()> {
    let StreamRequest {
        history,
        input,
        request_id,
    } = request;

    let trimmed = input.trim();

    if trimmed.is_empty() {
        return Err(LlmError::Path("Message cannot be empty".into()));
    }

    let config = state.current_config()?;
    let model = config
        .selected_model
        .clone()
        .ok_or_else(|| LlmError::Path("Select a model before chatting".into()))?;

    let provider = config.active_provider;
    let provider_config = config
        .providers
        .get(provider)
        .cloned()
        .ok_or(LlmError::MissingProviderConfig(provider))?;

    let mut conversation = history;

    let user_message = ChatMessage {
        id: next_id("user"),
        role: ChatRole::User,
        content: trimmed.to_string(),
        tool_call_id: None,
    };

    conversation.push(user_message);

    let tools = available_tools();

    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let result = stream_chat(
            provider,
            &provider_config,
            &model,
            &conversation,
            &tools,
            &app_handle,
            &request_id,
        );

        if let Err(err) = result {
            let _ = app_handle.emit(
                STREAM_EVENT,
                StreamEvent::Error {
                    request_id: request_id.clone(),
                    message: err.to_string(),
                },
            );
        }
    });

    Ok(())
}

fn fetch_models(provider: LlmProvider, config: &ProviderConnectionConfig) -> Result<Vec<LlmModel>> {
    match provider {
        LlmProvider::Vllm => fetch_vllm_models(config),
        LlmProvider::Ollama => fetch_ollama_models(config),
    }
}

fn http_client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(LlmError::from)
}

fn fetch_vllm_models(config: &ProviderConnectionConfig) -> Result<Vec<LlmModel>> {
    let url = format!("{}/v1/models", config.base_url);
    let client = http_client()?;

    let mut request = client.get(url);
    if let Some(key) = config.api_key.as_ref() {
        request = request.bearer_auth(key);
    }

    let response = request.send()?.error_for_status()?;
    let payload: OpenAiModelsResponse = response.json()?;

    Ok(payload
        .data
        .into_iter()
        .map(|model| LlmModel {
            id: model.id.clone(),
            label: model.id,
            provider: LlmProvider::Vllm,
        })
        .collect())
}

fn fetch_ollama_models(config: &ProviderConnectionConfig) -> Result<Vec<LlmModel>> {
    let url = format!("{}/api/tags", config.base_url);
    let client = http_client()?;
    let response = client.get(url).send()?.error_for_status()?;
    let payload: OllamaTagsResponse = response.json()?;

    Ok(payload
        .models
        .into_iter()
        .map(|model| LlmModel {
            label: format_ollama_label(&model),
            id: model.name.clone(),
            provider: LlmProvider::Ollama,
        })
        .collect())
}

fn format_ollama_label(model: &OllamaTag) -> String {
    if let Some(details) = model.details.as_ref() {
        if let Some(parameters) = details.parameter_size.as_ref() {
            return format!("{} · {}", model.name, parameters);
        }
    }
    model.name.clone()
}

struct ProviderAdapter {
    provider: LlmProvider,
}

impl ProviderAdapter {
    fn new(provider: LlmProvider) -> Self {
        Self { provider }
    }

    fn chat(
        &self,
        config: &ProviderConnectionConfig,
        model: &str,
        messages: &[ChatMessage],
        tools: &[OpenAiTool],
    ) -> Result<AssistantTurn> {
        match self.provider {
            LlmProvider::Vllm => chat_with_openai(config, model, messages, tools),
            LlmProvider::Ollama => chat_with_ollama(config, model, messages, tools),
        }
    }

    fn stream(
        &self,
        config: &ProviderConnectionConfig,
        model: &str,
        messages: &[ChatMessage],
        tools: &[OpenAiTool],
        request_id: &str,
        emit: &mut impl FnMut(StreamEvent),
    ) -> Result<()> {
        match self.provider {
            LlmProvider::Vllm => stream_openai(config, model, messages, tools, request_id, emit),
            LlmProvider::Ollama => stream_ollama(config, model, messages, tools, request_id, emit),
        }
    }
}

fn send_chat_completion(
    provider: LlmProvider,
    config: &ProviderConnectionConfig,
    model: &str,
    messages: &[ChatMessage],
    tools: &[OpenAiTool],
) -> Result<AssistantTurn> {
    ProviderAdapter::new(provider).chat(config, model, messages, tools)
}

fn stream_chat(
    provider: LlmProvider,
    config: &ProviderConnectionConfig,
    model: &str,
    messages: &[ChatMessage],
    tools: &[OpenAiTool],
    app: &AppHandle,
    request_id: &str,
) -> Result<()> {
    let mut emit = |event: StreamEvent| emit_stream(app, event);
    ProviderAdapter::new(provider).stream(config, model, messages, tools, request_id, &mut emit)
}

fn chat_with_openai(
    config: &ProviderConnectionConfig,
    model: &str,
    messages: &[ChatMessage],
    tools: &[OpenAiTool],
) -> Result<AssistantTurn> {
    let url = format!("{}/v1/chat/completions", config.base_url);
    let client = http_client()?;

    let payload = OpenAiChatRequest {
        model: model.to_string(),
        messages: messages.iter().map(OpenAiMessage::from).collect(),
        tools: tools.to_vec(),
        stream: false,
    };

    let mut request = client.post(url).json(&payload);
    if let Some(key) = config.api_key.as_ref() {
        request = request.bearer_auth(key);
    }

    let response = request.send()?.error_for_status()?;
    let body: OpenAiChatResponse = response.json()?;
    let first = body
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| LlmError::Path("No response from provider".into()))?;

    Ok(AssistantTurn::from_openai(first.message))
}

fn chat_with_ollama(
    config: &ProviderConnectionConfig,
    model: &str,
    messages: &[ChatMessage],
    tools: &[OpenAiTool],
) -> Result<AssistantTurn> {
    let url = format!("{}/api/chat", config.base_url);
    let client = http_client()?;

    let payload = OllamaChatRequest {
        model: model.to_string(),
        stream: false,
        messages: messages.iter().map(OllamaMessage::from).collect(),
        tools: tools.to_vec(),
    };

    let response = client.post(url).json(&payload).send()?.error_for_status()?;
    let body: OllamaChatResponse = response.json()?;
    Ok(AssistantTurn::from_ollama(body.message))
}

pub fn stream_openai(
    config: &ProviderConnectionConfig,
    model: &str,
    messages: &[ChatMessage],
    tools: &[OpenAiTool],
    request_id: &str,
    emit: &mut impl FnMut(StreamEvent),
) -> Result<()> {
    let url = format!("{}/v1/chat/completions", config.base_url);
    let client = http_client()?;

    let payload = OpenAiChatRequest {
        model: model.to_string(),
        messages: messages.iter().map(OpenAiMessage::from).collect(),
        tools: tools.to_vec(),
        stream: true,
    };

    let mut request = client.post(url).json(&payload);
    if let Some(key) = config.api_key.as_ref() {
        request = request.bearer_auth(key);
    }

    let response = request.send()?.error_for_status()?;
    let mut reader = BufReader::new(response);
    let mut line = String::new();

    while reader.read_line(&mut line)? > 0 {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            line.clear();
            continue;
        }

        let trimmed = trimmed.trim_start_matches("data:").trim();

        if trimmed == "[DONE]" {
            emit(StreamEvent::Done {
                request_id: request_id.to_string(),
            });
            break;
        }

        let chunk: OpenAiStreamChunk = serde_json::from_str(trimmed)?;
        for choice in chunk.choices.into_iter() {
            if let Some(delta) = choice.delta.content {
                if !delta.is_empty() {
                    emit(StreamEvent::Answer {
                        request_id: request_id.to_string(),
                        delta,
                    });
                }
            }
        }

        line.clear();
    }

    Ok(())
}

fn stream_ollama(
    config: &ProviderConnectionConfig,
    model: &str,
    messages: &[ChatMessage],
    tools: &[OpenAiTool],
    request_id: &str,
    emit: &mut impl FnMut(StreamEvent),
) -> Result<()> {
    let url = format!("{}/api/chat", config.base_url);
    let client = http_client()?;

    let payload = OllamaChatRequest {
        model: model.to_string(),
        stream: true,
        messages: messages.iter().map(OllamaMessage::from).collect(),
        tools: tools.to_vec(),
    };

    let response = client.post(url).json(&payload).send()?.error_for_status()?;
    let mut reader = BufReader::new(response);
    let mut line = String::new();

    while reader.read_line(&mut line)? > 0 {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            line.clear();
            continue;
        }

        let chunk: OllamaStreamChunk = serde_json::from_str(trimmed)?;

        if let Some(message) = chunk.message {
            if let Some(content) = message.content {
                if !content.is_empty() {
                    emit(StreamEvent::Answer {
                        request_id: request_id.to_string(),
                        delta: content,
                    });
                }
            }
        }

        if chunk.done.unwrap_or(false) {
            emit(StreamEvent::Done {
                request_id: request_id.to_string(),
            });
            break;
        }

        line.clear();
    }

    Ok(())
}

pub fn available_tools() -> Vec<OpenAiTool> {
    vec![OpenAiTool {
        r#type: "function".into(),
        function: OpenAiFunction {
            name: "mock_echo".into(),
            description: "Echo a short string for debugging the dialogue loop".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to echo back"}
                },
                "required": ["text"]
            }),
        },
    }]
}

fn execute_tool(call: &ToolCall) -> Result<String> {
    match call.name.as_str() {
        "mock_echo" => {
            let text = call
                .arguments
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("");
            Ok(format!("Echo: {}", text))
        }
        other => Err(LlmError::Tool(format!("Unknown tool: {}", other))),
    }
}

fn next_id(prefix: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros();
    format!("{}-{}", prefix, timestamp)
}

fn emit_stream(app: &AppHandle, event: StreamEvent) {
    let _ = app.emit(STREAM_EVENT, event);
}

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModel>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModel {
    id: String,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaTag>,
}

#[derive(Debug, Deserialize)]
struct OllamaTag {
    name: String,
    #[serde(default)]
    details: Option<OllamaDetails>,
}

#[derive(Debug, Deserialize)]
struct OllamaDetails {
    #[serde(default)]
    parameter_size: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct OpenAiTool {
    #[serde(rename = "type")]
    r#type: String,
    function: OpenAiFunction,
}

#[derive(Debug, Serialize, Clone)]
pub struct OpenAiFunction {
    name: String,
    description: String,
    parameters: Value,
}

#[derive(Debug, Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    stream: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OpenAiTool>,
}

#[derive(Debug, Serialize)]
struct OpenAiMessage {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

impl From<&ChatMessage> for OpenAiMessage {
    fn from(value: &ChatMessage) -> Self {
        Self {
            role: match value.role {
                ChatRole::System => "system",
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
                ChatRole::Tool => "tool",
            }
            .into(),
            content: value.content.clone(),
            tool_call_id: value.tool_call_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiAssistantMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiAssistantMessage {
    role: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<OpenAiToolCall>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct OpenAiToolCall {
    id: Option<String>,
    function: OpenAiToolFunctionCall,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct OpenAiToolFunctionCall {
    name: String,
    arguments: Value,
}

#[derive(Debug, Serialize)]
struct OllamaChatRequest {
    model: String,
    stream: bool,
    messages: Vec<OllamaMessage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OpenAiTool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<OpenAiToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

impl From<&ChatMessage> for OllamaMessage {
    fn from(value: &ChatMessage) -> Self {
        Self {
            role: match value.role {
                ChatRole::System => "system",
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
                ChatRole::Tool => "tool",
            }
            .into(),
            content: Some(value.content.clone()),
            tool_calls: Vec::new(),
            tool_call_id: value.tool_call_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: OllamaMessage,
}

#[derive(Debug)]
struct AssistantTurn {
    content: Option<String>,
    tool_calls: Vec<ToolCall>,
}

impl AssistantTurn {
    fn from_openai(message: OpenAiAssistantMessage) -> Self {
        Self {
            content: message.content,
            tool_calls: message
                .tool_calls
                .into_iter()
                .map(|call| ToolCall {
                    id: call.id.unwrap_or_else(|| next_id("tool-call")),
                    name: call.function.name,
                    arguments: normalize_arguments(call.function.arguments),
                })
                .collect(),
        }
    }

    fn from_ollama(message: OllamaMessage) -> Self {
        let content = message.content;
        let tool_calls = message
            .tool_calls
            .into_iter()
            .map(|call| ToolCall {
                id: call.id.unwrap_or_else(|| next_id("tool-call")),
                name: call.function.name,
                arguments: normalize_arguments(call.function.arguments),
            })
            .collect();

        Self { content, tool_calls }
    }
}

fn normalize_arguments(arguments: Value) -> Value {
    match arguments {
        Value::String(raw) => serde_json::from_str(&raw).unwrap_or(Value::String(raw)),
        other => other,
    }
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamChunk {
    choices: Vec<OpenAiStreamChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamChoice {
    delta: OpenAiStreamDelta,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamDelta {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaStreamChunk {
    #[serde(default)]
    message: Option<OllamaMessage>,
    #[serde(default)]
    done: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::{Method, MockServer};

    #[test]
    fn stream_openai_emits_answer_and_done() {
        let server = MockServer::start();
        let body = r#"
data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" world"}}]}

data: [DONE]
"#;

        let _mock = server.mock(|when, then| {
            when.method(Method::POST).path("/v1/chat/completions");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body(body);
        });

        let config = ProviderConnectionConfig {
            base_url: server.base_url(),
            api_key: None,
        };

        let mut events = Vec::new();
        stream_openai(
            &config,
            "demo-model",
            &[],
            &available_tools(),
            "req-1",
            &mut |evt| events.push(evt),
        )
        .expect("stream succeeds");

        assert!(matches!(
            events.last(),
            Some(StreamEvent::Done { request_id }) if request_id == "req-1"
        ));

        let deltas: String = events
            .iter()
            .filter_map(|evt| match evt {
                StreamEvent::Answer { delta, .. } => Some(delta.as_str()),
                _ => None,
            })
            .collect();

        assert_eq!(deltas, "Hello world");
    }
}
