# AGENT.md

## Project Overview

**shell-werk** is a Wails (Go) + React desktop app for local LLM chat with safe tool calling and shell execution. Project config lives in `wails.json`.

## Tech Stack

- **Backend**: Go 1.23, Wails v2.11
- **Frontend**: React 18, TypeScript 4.6, Vite 3
- **Package Manager**: npm (CI uses Node 20)
- **Testing**: Go tests; Playwright for end-to-end

## Project Structure

- `main.go`, `app.go`: Wails entrypoint and bound Go methods. Regenerate `frontend/wailsjs` after changing exported APIs (`wails generate module` or during dev/build).
- `frontend/`: React app. `src/App.tsx` holds chat UI/state; `wailsjs/` contains generated bindings; Vite config at `frontend/vite.config.ts`.
- `wails.json`: Wails project configuration (frontend commands, output file name).
- `docs/`: Requirements, stakeholder needs, and research. `docs/research/technical-research.md` is **critical** for LLM/tool/shell strategy; `docs/MIGRATION.md` records the Tauri → Wails switch.
- `.github/workflows/ci.yml`: CI runs `go test ./...` and Playwright (Ubuntu/Windows matrix).

## Development Commands

- Live dev: `wails dev` (runs Vite dev server automatically).
- Build: `wails build`.
- Frontend only: `npm -C frontend run dev|build|preview` (install deps first).
- Tests: `go test ./...`; Playwright (after installing deps and browsers) via `npm -C frontend run build`, `npx playwright install [--with-deps]`, `npx playwright test`.
- Regenerate bindings when Go APIs change: `wails generate module`.

## Current Functionality

- Chat UI with multiple sessions persisted to `localStorage` under `shellwerk:sessions`.
- Messages include user entries and a placeholder assistant reply; Enter submits; Send button mirrors Enter; auto-scroll to newest message; create/select sessions.
- Settings modal captures provider/endpoint/model (Ollama/vLLM/mock) but backend wiring is pending; “Chat-only mode pending” chip reflects that state.
- Styling lives in `frontend/src/App.css` and `frontend/src/style.css`.

## Guidelines

1. Check `docs/requirements/` for acceptance criteria and `docs/stakeholder-needs/` for mappings before implementing features.
2. Follow `docs/research/technical-research.md` for LLM tool calling, shell execution, reasoning UI, and testing strategy.
3. Respect Wails v2 patterns: bind Go methods in `main.go`, keep `frontend/wailsjs` in sync, avoid Tauri-specific APIs.
4. Centralize shell/LLM validation in Go per research; surface provider capabilities cleanly to the React UI.
5. Keep CI parity: ensure `go test ./...` and Playwright suites stay green on Ubuntu and Windows.
6. Add Playwright E2E coverage for new features per `REQ-008`, using mocked providers unless intentionally running real ones.
