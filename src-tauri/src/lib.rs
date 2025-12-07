mod llm;

pub use llm::{LlmConfiguration, LlmModel, LlmProvider, LlmState};
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_llm_configuration(state: tauri::State<LlmState>) -> Result<LlmConfiguration, String> {
    state.current_config().map_err(|err| err.to_string())
}

#[tauri::command]
fn save_llm_configuration(
    state: tauri::State<LlmState>,
    payload: LlmConfiguration,
) -> Result<LlmConfiguration, String> {
    state.persist_config(payload).map_err(|err| err.to_string())
}

#[tauri::command]
fn list_llm_models(
    state: tauri::State<LlmState>,
    provider: Option<LlmProvider>,
) -> Result<Vec<LlmModel>, String> {
    state.list_models(provider).map_err(|err| err.to_string())
}

#[tauri::command]
fn select_llm_model(
    state: tauri::State<LlmState>,
    model_id: Option<String>,
) -> Result<LlmConfiguration, String> {
    state
        .update_selected_model(model_id)
        .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = LlmState::initialize()?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_llm_configuration,
            save_llm_configuration,
            list_llm_models,
            select_llm_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
