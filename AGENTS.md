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
- `docs/`: Requirements, stakeholder needs, and research. `docs/research/technical-research.md` is **critical** for LLM/tool/shell strategy.
- `.github/workflows/ci.yml`: CI runs `go test ./...` and Playwright (Ubuntu/Windows matrix).

## Development Commands

- Live dev: `wails dev` (runs Vite dev server automatically).
- Build: `wails build`.
- Frontend only: `npm -C frontend run dev|build|preview` (install deps first).
- Tests: `go test ./...`; `npm -C frontend run test:e2e` (starts app and runs Playwright E2E).
- Regenerate bindings when Go APIs change: `wails generate module`.

## Current Functionality

- Chat UI with multiple sessions persisted to `localStorage` under `shellwerk:sessions`.
- Styling lives in `frontend/src/App.css` and `frontend/src/style.css`.

## Guidelines

1. Check `docs/requirements/` for acceptance criteria and `docs/stakeholder-needs/` for mappings before implementing features.
2. Follow `docs/research/technical-research.md` for LLM tool calling, shell execution, reasoning UI, and testing strategy.
3. Respect Wails v2 patterns: bind Go methods in `main.go`, keep `frontend/wailsjs` in sync, avoid Tauri-specific APIs.
4. Centralize shell/LLM validation in Go per research; surface provider capabilities cleanly to the React UI.
5. Keep CI parity: ensure `go test ./...` and Playwright suites stay green on Ubuntu and Windows.
6. Add Playwright E2E coverage for new features per `REQ-008`, using mocked providers unless intentionally running real ones.
   6.6 Every checkbox for the requirements must be covered by at least one test in the codebase.
7. Update the checkboxes in `docs/requirements/` as features are completed AND tested.
8. Run tests after adding features or changing code: `go test ./...` and `npm -C frontend run test:e2e`.
