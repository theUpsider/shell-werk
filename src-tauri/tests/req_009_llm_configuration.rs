#[path = "support/mod.rs"]
mod support;

use httpmock::{Method, MockServer};
use serial_test::serial;
use serde_json::json;
use shell_werk_lib::{LlmProvider, LlmState};
use support::{assert_acceptance_criterion, ConfigOverrideGuard};

#[test]
#[serial]
fn req_009_supports_connection_to_vllm() {
    assert_acceptance_criterion(
        "REQ-009",
        "The application supports connection to vLLM.",
    );

    let _guard = ConfigOverrideGuard::new();
    let server = MockServer::start();
    let _mock = server.mock(|when, then| {
        when.method(Method::GET).path("/v1/models");
        then.status(200).json_body(json!({
            "data": [
                {"id": "qwen3"},
                {"id": "deepseek"}
            ]
        }));
    });

    let state = LlmState::initialize().expect("state initializes");
    let mut config = state.current_config().expect("read config");
    config.providers.vllm.base_url = server.base_url();
    state.persist_config(config).expect("persist config");

    let models = state
        .list_models(Some(LlmProvider::Vllm))
        .expect("lists models");
    assert_eq!(models.len(), 2);
    assert!(models.iter().all(|model| model.provider == LlmProvider::Vllm));
}

#[test]
#[serial]
fn req_009_supports_connection_to_ollama() {
    assert_acceptance_criterion(
        "REQ-009",
        "The application supports connection to Ollama.",
    );

    let _guard = ConfigOverrideGuard::new();
    let server = MockServer::start();
    let _mock = server.mock(|when, then| {
        when.method(Method::GET).path("/api/tags");
        then.status(200).json_body(json!({
            "models": [
                {
                    "name": "qwen3",
                    "details": {"parameter_size": "4B"}
                }
            ]
        }));
    });

    let state = LlmState::initialize().expect("state initializes");
    let mut config = state.current_config().expect("read config");
    config.active_provider = LlmProvider::Ollama;
    config.providers.ollama.base_url = server.base_url();
    state.persist_config(config).expect("persist config");

    let models = state
        .list_models(Some(LlmProvider::Ollama))
        .expect("lists models");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "qwen3");
    assert_eq!(models[0].label, "qwen3 · 4B");
}

#[test]
#[serial]
fn req_009_retrieves_models_based_on_active_provider() {
    assert_acceptance_criterion(
        "REQ-009",
        "The application retrieves the list of available LLMs based on the configured settings.",
    );

    let _guard = ConfigOverrideGuard::new();
    let server = MockServer::start();
    let _mock = server.mock(|when, then| {
        when.method(Method::GET).path("/v1/models");
        then.status(200).json_body(json!({
            "data": [
                {"id": "granite"}
            ]
        }));
    });

    let state = LlmState::initialize().expect("state initializes");
    let mut config = state.current_config().expect("read config");
    config.active_provider = LlmProvider::Vllm;
    config.providers.vllm.base_url = server.base_url();
    state.persist_config(config).expect("persist config");

    let models = state.list_models(None).expect("lists models");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "granite");
}

#[test]
#[serial]
fn req_009_persists_selected_llm() {
    assert_acceptance_criterion(
        "REQ-009",
        "The settings for the selected LLM are saved and persisted.",
    );

    let _guard = ConfigOverrideGuard::new();
    let state = LlmState::initialize().expect("state initializes");
    state
        .update_selected_model(Some("granite-3b".into()))
        .expect("select model");
    drop(state);

    let state = LlmState::initialize().expect("state reinitializes");
    let config = state.current_config().expect("read config");
    assert_eq!(config.selected_model.as_deref(), Some("granite-3b"));
}

#[test]
#[serial]
fn req_009_persists_provider_configuration() {
    assert_acceptance_criterion(
        "REQ-009",
        "The configuration for the providers (e.g., URLs, keys) is saved and persisted across app restarts.",
    );

    let _guard = ConfigOverrideGuard::new();
    let state = LlmState::initialize().expect("state initializes");
    let mut config = state.current_config().expect("read config");
    config.providers.vllm.base_url = "http://127.0.0.1:1234".into();
    config.providers.vllm.api_key = Some("sk-test".into());
    state.persist_config(config).expect("persist config");
    drop(state);

    let state = LlmState::initialize().expect("state reinitializes");
    let config = state.current_config().expect("read config");
    assert_eq!(config.providers.vllm.base_url, "http://127.0.0.1:1234");
    assert_eq!(config.providers.vllm.api_key.as_deref(), Some("sk-test"));
}
