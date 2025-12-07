use directories::ProjectDirs;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf, sync::Mutex, time::Duration};

const CONFIG_FILE: &str = "llm-config.json";
const QUALIFIER: &str = "com";
const ORGANIZATION: &str = "theupsider";
const APPLICATION: &str = "shell-werk";
const CONFIG_OVERRIDE_ENV: &str = "SHELL_WERK_LLM_CONFIG_PATH";

pub type Result<T> = std::result::Result<T, LlmError>;

#[derive(Debug)]
pub enum LlmError {
    Io(std::io::Error),
    Serde(serde_json::Error),
    Http(reqwest::Error),
    Path(String),
    MissingProviderConfig(LlmProvider),
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::Io(err) => write!(f, "I/O error: {}", err),
            LlmError::Serde(err) => write!(f, "Invalid configuration: {}", err),
            LlmError::Http(err) => write!(f, "Request failed: {}", err),
            LlmError::Path(msg) => write!(f, "{}", msg),
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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
