
# Migration Guide: Tauri → Wails

This document describes how to migrate an existing Tauri + React/TypeScript desktop app to Wails (v2).

---

## 1. Concepts: Tauri vs Wails

**Tauri**

- Backend: Rust
- Frontend: Any web stack (often React/TS)
- IPC: `tauri::command`, `invoke`, events
- Config: `tauri.conf.json`
- Build: `cargo tauri build`

**Wails**

- Backend: Go
- Frontend: Any web stack (React/TS, etc.)
- IPC: Exported Go struct methods bound to JS
- Config: `wails.json`
- Build: `wails build`

High-level strategy:

1. **Keep the frontend almost unchanged** (React/TS, routing, components).
2. **Rewrite Tauri commands in Go** and expose them as Wails bindings.
3. **Replace Tauri-specific JS APIs** with Wails equivalents.

---

## 2. Prepare Wails Skeleton

1. Install Wails CLI (Go must be installed):

   ```
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   ```

2. Create a new Wails app (React + TS template):

   ```
   wails init -n my-wails-app
   # Choose: React + TypeScript template (or closest to your current stack)
   ```

3. Directory comparison:

- **Tauri** (example):
  - `src/` – React frontend
  - `src-tauri/` – Rust backend
  - `tauri.conf.json`

- **Wails**:
  - `frontend/` – React frontend
  - `backend/` (or `./`) – Go code (`main.go`, `app.go`, etc.)
  - `wails.json`

We will:
- Copy `src` → `frontend` (or integrate selectively).
- Re-implement `src-tauri/src/main.rs` logic in Go.

---

## 3. Frontend Migration

### 3.1 Move Frontend Code

1. In the Wails project, remove or archive the default `frontend` contents.
2. Copy your Tauri `src` (or equivalent) into `frontend`.

Example:

```
cd my-wails-app
rm -rf frontend/*
cp -r ../my-tauri-app/src/* frontend/
```

3. Adjust tooling if necessary:
   - Ensure `frontend/package.json` scripts align with Wails expectations:

   ```
   {
     "scripts": {
       "dev": "vite",            // or your choice
       "build": "vite build",
       "preview": "vite preview"
     }
   }
   ```

4. Update `wails.json` to match your dev/build commands:

```
{
  "name": "MyApp",
  "frontend": {
    "dir": "frontend",
    "install": "npm install",
    "build": "npm run build",
    "dev": {
      "command": "npm run dev",
      "url": "http://localhost:5173"
    }
  },
  "outputfilename": "myapp"
}
```

---

## 4. IPC / Backend Migration

### 4.1 Identify Tauri Commands

Tauri commands are defined in Rust, e.g.:

```
#[tauri::command]
fn get_config() -> Result<Config, String> { ... }

#[tauri::command]
async fn run_job(params: JobParams) -> Result<JobResult, String> { ... }
```

In JS/TS, they are called via:

```
import { invoke } from '@tauri-apps/api/tauri';

const config = await invoke<Config>('get_config');
```

List all commands and their signatures. These will become Go methods.

### 4.2 Create Wails Backend Struct

In Wails, you typically define an `App` struct and export methods.

Create `backend/app.go`:

```
package main

import (
	"context"
)

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Example migrated method
type Config struct {
	// fields matching your TS/Rust model
}

func (a *App) GetConfig() (Config, error) {
	// port logic from Rust get_config()
	return Config{/* ... */}, nil
}
```

Update `main.go` (or equivalent) to bind `App`:

```
package main

import (
	"embed"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "MyApp",
		Width:  1024,
		Height: 768,
		Assets: assets,
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
```

### 4.3 Replace `invoke` Calls with Wails Calls

Wails generates a JS/TS API for bound methods. After running `wails generate module`, you’ll typically import from `wailsjs` (paths may vary depending on template).

Example (conceptual):

```
// Old (Tauri):
import { invoke } from "@tauri-apps/api/tauri";

const config = await invoke<Config>("get_config");

// New (Wails):
import { GetConfig } from "../wailsjs/go/main/App"; // path may differ

const config = await GetConfig();
```

Migration steps:

1. Run a first dev build to generate Wails JS bindings:

   ```
   wails dev
   # or
   wails generate module
   ```

2. Search for all Tauri invocations:

   - `@tauri-apps/api/tauri`
   - `@tauri-apps/api/shell`
   - `@tauri-apps/api/fs`
   - `@tauri-apps/api/path`
   - `@tauri-apps/api/process`
   - `emit`, `listen`, `Window` APIs, etc.

3. For each, map to:
   - A bound Go method exposed to JS (for custom logic).
   - Or native Go APIs (for filesystem, processes, env, etc.) wrapped inside `App` methods.

---

## 5. API Mapping (Common Cases)

### 5.1 File System

**Tauri:**

```
import { readTextFile, writeTextFile } from "@tauri-apps/api/fs";

const content = await readTextFile("config.json");
await writeTextFile("config.json", JSON.stringify(data));
```

**Wails approach:**

1. Implement file access in Go:

   ```
   import "os"

   func (a *App) ReadConfig(path string) (string, error) {
       bytes, err := os.ReadFile(path)
       if err != nil {
           return "", err
       }
       return string(bytes), nil
   }

   func (a *App) WriteConfig(path string, content string) error {
       return os.WriteFile(path, []byte(content), 0o600)
   }
   ```

2. Call from TS:

   ```
   import { ReadConfig, WriteConfig } from "../wailsjs/go/main/App";

   const content = await ReadConfig("config.json");
   await WriteConfig("config.json", JSON.stringify(data));
   ```

### 5.2 Running Shell Commands

**Tauri:**

```
import { Command } from "@tauri-apps/api/shell";

const cmd = new Command("echo", ["hello"]);
const output = await cmd.execute();
```

**Wails (Go `os/exec`):**

```
import (
	"bytes"
	"os/exec"
)

func (a *App) RunCommand(name string, args []string) (string, error) {
	cmd := exec.Command(name, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return out.String(), err
}
```

TS:

```
import { RunCommand } from "../wailsjs/go/main/App";

const output = await RunCommand("echo", ["hello"]);
```

### 5.3 Events

Tauri has event APIs (`emit`, `listen`). Wails offers:

- Go → frontend events using `runtime.EventsEmit`.
- Frontend → Go via bound methods.

Example Go:

```
import "github.com/wailsapp/wails/v2/pkg/runtime"

func (a *App) NotifySomething() {
    runtime.EventsEmit(a.ctx, "something-happened", "payload")
}
```

Frontend:

```
import { EventsOn } from "../wailsjs/runtime"; // template-dependent

EventsOn("something-happened", (data) => {
  console.log("Event:", data);
});
```

Port any Tauri events to equivalent Wails event channels and listener setup.

---

## 6. Configuration & Window Options

### Tauri (example)

```
// tauri.conf.json
{
  "package": { "productName": "MyApp" },
  "tauri": {
    "windows": [
      { "title": "MyApp", "width": 1024, "height": 768 }
    ]
  }
}
```

### Wails (`wails.json`)

```
{
  "name": "MyApp",
  "outputfilename": "myapp",
  "author": "You",
  "wails": {
    "windows": {
      "title": "MyApp",
      "width": 1024,
      "height": 768,
      "resizable": true
    }
  }
}
```

Adjust:
- Title, width/height, min sizes
- Single vs multi-window (Wails is simpler; multi-window support is more manual).

---

## 7. Build & Distribution

### Development

- **Tauri:** `npm run tauri dev` / `cargo tauri dev`
- **Wails:** `wails dev`

Run from Wails project root:

```
wails dev
```

This:
- Starts frontend dev server (e.g., Vite).
- Starts Go backend.
- Opens app window.

### Production Build

- **Tauri:** `cargo tauri build`
- **Wails:** `wails build`

```
wails build
# Binaries in build/bin (platform-dependent)
```

Configure icons, installer, and platform-specific metadata as needed via Wails docs.

---

## 8. Systematic Migration Checklist

1. **Create Wails skeleton** with React/TS template.
2. **Move frontend:**
   - Copy Tauri `src` → Wails `frontend`.
   - Align `package.json` scripts and `wails.json` frontend config.
3. **List Tauri APIs used** in frontend:
   - `invoke` commands
   - `fs`, `shell`, `path`, `process`
   - `events`, `window`, etc.
4. **Re-implement backend:**
   - Translate each Rust `#[tauri::command]` to a Go method on `App`.
   - For FS/commands, wrap Go stdlib (`os`, `os/exec`, `io`, etc.).
5. **Bind Go methods** in `main.go` and run `wails dev` / `wails generate module`.
6. **Replace Tauri imports in TS**:
   - Remove `@tauri-apps/api/*` imports.
   - Use generated `wailsjs` bindings instead.
7. **Replace events**:
   - Map Tauri event channels to Wails `runtime.EventsEmit` + frontend listeners.
8. **Test end-to-end in dev mode**.
9. **Build production binary** with `wails build`.
10. **Update docs and scripts**:
    - Remove Tauri-related scripts from root `package.json`.
    - Add `wails dev` / `wails build` instructions.

---

## 9. Notes & Gotchas

- **Async behavior**: Wails Go methods are synchronous from the Go side but return Promises in JS; long-running tasks should be offloaded (goroutines, channels, etc.).
- **Path handling**: Tauri’s `path` API has built-ins for app dirs; in Wails, use `os.UserHomeDir()`, environment vars, or a small wrapper for platform-specific dirs.
- **Security**: Keep all privileged operations in Go; frontend remains untrusted UI.
- **Type safety**: Mirror TS types in Go structs. If needed, define shared JSON contracts and keep naming consistent.

---
