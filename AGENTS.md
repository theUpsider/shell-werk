# AGENT.md

## Project Overview

**shell-werk** is a desktop application built with Tauri that provides a chat interface for interacting with Local Large Language Models (LLMs) such as Ollama and vLLM. A key focus of the project is enabling LLM tool calling and cross-platform shell execution (Windows & Linux).

## Tech Stack

- **Framework**: [Tauri v2](https://v2.tauri.app/)
- **Backend**: Rust
- **Frontend**: React 19, TypeScript, Vite 7
- **Package Manager**: Yarn

## Project Structure

- **`src/`**: Frontend source code (React components, assets, styles).
- **`src-tauri/`**: Backend source code (Rust, Tauri configuration).
  - `src-tauri/src/lib.rs`: Main entry point for Tauri commands and setup.
  - `src-tauri/tauri.conf.json`: Main Tauri configuration.
- **`docs/`**: Project documentation.
  - `docs/requirements/`: Individual requirement files (e.g., `REQ-001.md`).
  - `docs/stakeholder-needs/`: Stakeholder needs mapping.
  - `docs/research/technical-research.md`: **CRITICAL** - Contains implementation strategies for LLM tool calling and shell integration. Read this before implementing backend features.

## Development Commands

- **Start Development Server**: `yarn tauri dev`
- **Frontend Only**: `yarn dev`
- **Build**: `yarn tauri build`

## Key Features & Context

- **Chat Interface**: Modeled after standard chat apps (REQ-001).
- **LLM Integration**: Supports OpenAI-compatible APIs (Ollama, vLLM).
- **Tool Calling**: The application is designed to allow LLMs to execute local tools/commands.
- **Platform**: Windows and Linux support.

## Guidelines

1.  **Check Documentation**: Before implementing a feature, check `docs/requirements/` for specific acceptance criteria.
2.  **Consult Research**: For complex technical tasks (especially LLM or Shell related), refer to `docs/research/technical-research.md` for established patterns and decisions.
3.  **Tauri v2**: Remember this project uses Tauri v2. Ensure any API calls or configuration changes are compatible with v2 (e.g., plugin system, permissions).
    - **Permissions**: This project uses Tauri's Capability system (ACL). Check `src-tauri/capabilities/` when adding new native capabilities.
4.  **React 19**: The frontend uses React 19. Use modern React patterns.
5.  Check the acceptance criteria in the requirement files to ensure full compliance when implementing features.
6.  Add the e2e tests for the features you implement, as specified in REQ-008.
