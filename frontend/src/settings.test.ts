import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  loadSettings,
  persistSettings,
  SETTINGS_KEY,
  type SettingsState,
  type SettingsStorage,
} from "./settings";

const createMemoryStorage = (
  initial: Record<string, string> = {}
): SettingsStorage & { store: Map<string, string> } => {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
};

describe("loadSettings", () => {
  it("returns defaults when storage is empty", () => {
    const storage = createMemoryStorage();
    const settings = loadSettings(storage);

    expect(settings).toStrictEqual(defaultSettings);
  });

  it("returns cached settings when valid", () => {
    const cached: SettingsState = {
      provider: "vllm",
      endpoint: "https://vllm.internal",
      model: "mistral:7b",
    };
    const storage = createMemoryStorage({
      [SETTINGS_KEY]: JSON.stringify(cached),
    });

    const settings = loadSettings(storage);

    expect(settings).toStrictEqual(cached);
  });

  it("falls back to defaults when cache is invalid", () => {
    const storage = createMemoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ provider: "", endpoint: "", model: "" }),
    });

    const settings = loadSettings(storage);

    expect(settings).toStrictEqual(defaultSettings);
  });
});

describe("persistSettings", () => {
  it("writes settings to storage with the configured key", () => {
    const storage = createMemoryStorage();
    const next: SettingsState = {
      provider: "ollama",
      endpoint: "http://localhost:11434",
      model: "llama3",
    };

    persistSettings(storage, next);

    expect(storage.store.get(SETTINGS_KEY)).toEqual(JSON.stringify(next));
  });
});
