use once_cell::sync::Lazy;
use shell_werk_lib::LlmConfiguration;
use std::{
    collections::HashMap,
    env,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tempfile::TempDir;

const CONFIG_FILE_NAME: &str = "llm-config.json";
pub const CONFIG_OVERRIDE_ENV: &str = "SHELL_WERK_LLM_CONFIG_PATH";

static REQUIREMENT_CACHE: Lazy<Mutex<HashMap<String, Vec<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub struct ConfigOverrideGuard {
    temp_dir: TempDir,
    path: PathBuf,
    previous: Option<String>,
}

impl ConfigOverrideGuard {
    pub fn new() -> Self {
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        let path = temp_dir.path().join(CONFIG_FILE_NAME);
        let previous = env::var(CONFIG_OVERRIDE_ENV).ok();
        env::set_var(CONFIG_OVERRIDE_ENV, &path);
        Self {
            temp_dir,
            path,
            previous,
        }
    }

    pub fn config_path(&self) -> &Path {
        &self.path
    }

    pub fn write_config(&self, config: &LlmConfiguration) {
        let payload = serde_json::to_string_pretty(config).expect("serialize config");
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).expect("create parent directories");
        }
        fs::write(&self.path, payload).expect("write config override");
    }
}

impl Drop for ConfigOverrideGuard {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.as_ref() {
            env::set_var(CONFIG_OVERRIDE_ENV, previous);
        } else {
            env::remove_var(CONFIG_OVERRIDE_ENV);
        }
    }
}

pub fn assert_acceptance_criterion(requirement_id: &str, criterion: &str) {
    let criteria = load_acceptance_criteria(requirement_id);
    assert!(
        criteria.iter().any(|item| item == criterion.trim()),
        "Criterion \"{}\" not found in {}. Available: {:?}",
        criterion,
        requirement_id,
        criteria
    );
}

fn load_acceptance_criteria(requirement_id: &str) -> Vec<String> {
    let mut cache = REQUIREMENT_CACHE.lock().expect("requirement cache poisoned");
    if let Some(cached) = cache.get(requirement_id) {
        return cached.clone();
    }

    let path = workspace_root()
        .join("docs")
        .join("requirements")
        .join(format!("{}.md", requirement_id));
    let contents = fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("Unable to read {}: {}", path.display(), err));

    let criteria = contents
        .lines()
        .filter_map(parse_criterion)
        .collect::<Vec<_>>();

    cache.insert(requirement_id.to_string(), criteria.clone());
    criteria
}

fn parse_criterion(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with("- [") {
        return None;
    }

    let end_bracket = trimmed.find(']')?;
    let remainder = trimmed.get(end_bracket + 1..)?.trim();
    if remainder.is_empty() {
        return None;
    }

    Some(remainder.to_string())
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}
