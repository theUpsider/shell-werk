# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## E2E Testing

Playwright drives all acceptance testing. Each `describe` block targets a single requirement and every `test` maps to one acceptance-criteria checkbox inside `docs/requirements`.

1. Install the browsers once: `npx playwright install --with-deps` (or `yarn playwright install`).
2. Make sure Ollama is running locally with the `qwen3:4b` model: `ollama run qwen3:4b`.
3. Run the suite with `yarn test:e2e` (add `:headed` for a visible browser).

CI automatically sets `CI=true`, which flips the suite into mock mode so no Ollama connectivity is required in pipelines.
