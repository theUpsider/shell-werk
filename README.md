# shell-werk

[![CI](https://github.com/theUpsider/shell-werk/actions/workflows/ci.yml/badge.svg)](https://github.com/theUpsider/shell-werk/actions/workflows/ci.yml)

Local-first Wails (Go 1.23) + React 18 desktop app for chatting with local LLMs, streaming their reasoning, and safely invoking tools and shell commands.

## What's inside
- Wails 2.11 backend with bindings in `app.go`/`main.go`; regenerate `frontend/wailsjs` with `wails generate module` after changing exported Go APIs.
- Provider layer for Ollama, vLLM (OpenAI-compatible), and a mock provider with tool-call normalization and streaming.
- Tool registry (`internal/tools`) with shell, browser fetch, Brave `web_search`, and `request_fullfilled`; tool visibility and enablement are user-togglable.
- Sessions persisted to `localStorage` (`shellwerk:sessions`) and settings/configs persisted to `shellwerk:settings`; thinking traces stream via Wails events.
- Guarded shell executor (`internal/shell`) with validation, timeouts, and a chat-only kill switch in the UI.
- Docs in `docs/requirements`, `docs/stakeholder-needs`, and `docs/research/technical-research.md`; CI workflow in `.github/workflows/ci.yml`.

## Project layout
- `frontend/`: React + Vite app; main UI in `src/App.tsx`, styling in `src/App.css` and `src/style.css`.
- `internal/llm/`: provider implementations, streaming dialogue loop, and model listing helpers.
- `internal/tools/`: tool definitions exposed to the LLM and UI.
- `internal/shell/`: backend shell executor (PowerShell on Windows).
- `build/`: packaged artifacts (dev/prod builds land in `build/bin/`).
- `wails.json`: Wails project config (frontend commands, output binary name).

## Prerequisites
- Go 1.23+
- Node 20+ with npm
- Wails CLI installed (`wails` on PATH)
- Playwright browsers for E2E (`npx -C frontend playwright install --with-deps chromium`)

## Setup
1) Install frontend deps: `npm -C frontend install`
2) Download Go modules: `go mod download`
3) If Go bindings change: `wails generate module`

## Development
- Full app with hot reload: `wails dev` (starts the Vite dev server automatically)
- Frontend only: `npm -C frontend run dev`
- Preview a production-like build: `npm -C frontend run build && npm -C frontend run preview`

## Configuration
- Manage provider/model configs in the Settings modal; multiple endpoints/models are supported with an active selection.
- Defaults target `http://localhost:11434` (overridable via `VITE_VLLM_URL` or `VITE_VLLM_ENDPOINT` and `VITE_VLLM_API_KEY` in env/.env).
- Toggle chat-only mode to disable shell execution; per-tool visibility/enablement is persisted in `shellwerk:settings`.

## Tools and shell safety
- Built-in tools: shell (limited, executed via backend with validation and timeouts), browser fetch, Brave web search, and request completion marker.
- Shell commands always run in Go (PowerShell on Windows) and never directly from the web UI.

## Testing
- Go unit/integration: `go test ./...`
- Frontend unit: `npm -C frontend run test`
- Playwright E2E (mocked providers): `npm -C frontend run test:e2e`
  - First run: `npx -C frontend playwright install --with-deps chromium`
  - Real provider smoke (optional): `$env:E2E_USE_REAL_PROVIDER=1; npm -C frontend run test:e2e`
- CI runs `go test ./...` and the Playwright suite (see `.github/workflows/ci.yml`).

## Building
- Production build: `wails build` (artifacts in `build/`, binary in `build/bin/`)
