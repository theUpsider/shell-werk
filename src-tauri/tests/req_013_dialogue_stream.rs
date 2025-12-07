#[path = "support/mod.rs"]
mod support;

use httpmock::{Method, MockServer};
use serial_test::serial;
use serde_json::json;
use shell_werk_lib::{LlmProvider, LlmState};
use support::{assert_acceptance_criterion, ConfigOverrideGuard, CONFIG_OVERRIDE_ENV};

#[test]
#[serial]
fn req_013_streams_answer_tokens() {
    assert_acceptance_criterion(
        "REQ-013",
        "The loop continues until the AI provides a final answer.",
    );

    // Prepare config override so the test uses an isolated file.
    let _guard = ConfigOverrideGuard::new();
    std::env::set_var(CONFIG_OVERRIDE_ENV, _guard.config_path());

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

    // Wire the active provider to the mock server.
    let state = LlmState::initialize().expect("state initializes");
    let mut config = state.current_config().expect("read config");
    config.active_provider = LlmProvider::Vllm;
    config.providers.vllm.base_url = server.base_url();
    config.selected_model = Some("demo-model".into());
    state.persist_config(config).expect("persist config");

    // Build a minimal request and capture streaming output by calling the streaming helper directly.
    let mut collected = Vec::new();
    shell_werk_lib::llm::stream_openai(
        &shell_werk_lib::llm::ProviderConnectionConfig {
            base_url: server.base_url(),
            api_key: None,
        },
        "demo-model",
        &[],
        &shell_werk_lib::llm::available_tools(),
        "req-1",
        &mut |event| collected.push(event),
    )
    .expect("stream succeeds");

    let answer: String = collected
        .iter()
        .filter_map(|evt| match evt {
            shell_werk_lib::llm::StreamEvent::Answer { delta, .. } => Some(delta.as_str()),
            _ => None,
        })
        .collect();

    assert_eq!(answer, "Hello world");
    assert!(matches!(
        collected.last(),
        Some(shell_werk_lib::llm::StreamEvent::Done { request_id }) if request_id == "req-1"
    ));
}
