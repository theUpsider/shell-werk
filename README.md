# Shell Werk

[![Tauri Tests](https://github.com/theUpsider/shell-werk/actions/workflows/tauri-tests.yml/badge.svg)](https://github.com/theUpsider/shell-werk/actions/workflows/tauri-tests.yml)

Shell Werk is a cross-platform desktop chat client built with Tauri v2, React 19, and Vite. It focuses on local LLM workflows, tool calling, and shell execution safeguards while keeping feature coverage traceable back to the requirements in `docs/requirements`.

## Local Development

- `yarn dev` runs the React front end in Vite.
- `yarn tauri dev` launches the full desktop shell with Rust commands.

## Testing Strategy

### Playwright E2E (REQ-007, REQ-008)

Each `describe` block maps to a requirement and every `test` matches a single acceptance criterion.

1. Install the browsers once: `npx playwright install --with-deps` (or `yarn playwright install`).
2. Make sure Ollama is running locally with the `qwen3:4b` model: `ollama run qwen3:4b`.
3. Execute the suite with `yarn test:e2e` (append `:headed` for a visible browser session).

CI sets `CI=true`, which switches the suite into mock mode so Ollama is not required in pipelines.

### Tauri Integration Tests (REQ-014)

Mocked integration tests live in `src-tauri/tests` and exercise the Rust commands directly, keeping desktop functionality deterministic.

- Run them locally with `yarn test:tauri` (wraps `cargo test` against `src-tauri`).
- Tests never talk to live LLM endpoints. Instead they rely on in-process HTTP mocks and point the configuration file to a throwaway temp directory.
- Every test asserts its corresponding acceptance criterion via the helper in `src-tauri/tests/support`, ensuring traceability back to `REQ-###` checkboxes.

#### Configuration Override

Set `SHELL_WERK_LLM_CONFIG_PATH` to point to a writable JSON file if you want to run the app or tests against a transient configuration (the integration suite handles this automatically). When the variable is unset, the app falls back to the OS-specific configuration directory resolved via `directories::ProjectDirs`.

CI runs the mocked Tauri tests on each push and pull request targeting `main` via `.github/workflows/tauri-tests.yml`, so local runs match the pipeline behavior.
