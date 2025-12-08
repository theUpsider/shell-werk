# README

[![CI](https://github.com/theUpsider/shell-werk/actions/workflows/ci.yml/badge.svg)](https://github.com/theUpsider/shell-werk/actions/workflows/ci.yml)

## About

shell-werk is a Wails (Go) + React app that provides a chat interface for local LLMs with safe tool calling and shell execution. Configure the project via `wails.json`. Docs: https://wails.io/docs/reference/project-config

## Live Development

To run in live development mode, run `wails dev` in the project directory. This will run a Vite development
server that will provide very fast hot reload of your frontend changes. If you want to develop in a browser
and have access to your Go methods, there is also a dev server that runs on http://localhost:34115. Connect
to this in your browser, and you can call your Go code from devtools.

## Building

To build a redistributable, production mode package, use `wails build`.

## Testing

- Go tests (unit/integration):

  - `go test ./...`

- Playwright end-to-end tests (mocked providers by default):

  - Install Node deps: `npm -C frontend install`
  - Install browsers (first run): `npx -C frontend playwright install --with-deps chromium`
  - Run tests: `npm -C frontend run test:e2e`

- Real providers locally (optional):
  - `$env:E2E_USE_REAL_PROVIDER=1; npm -C frontend run test:e2e` (requires the Wails app + provider running locally). CI always uses the mocked bridge.

Note: The CI workflow should run `go test ./...` and `npm -C frontend run test:e2e` on push/PR. The badge above points to `actions/workflows/ci.yml`—adjust if your workflow file uses a different name.
