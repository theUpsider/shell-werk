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

    expect(settings.configs).toHaveLength(1);
    expect(settings.activeConfigId).toEqual(settings.configs[0].id);
    expect(settings).toMatchObject({
      chatOnly: true,
      hiddenToolsDisabled: [],
    });
    expect(settings.configs[0]).toMatchObject({
      provider: defaultSettings.configs[0].provider,
      endpoint: defaultSettings.configs[0].endpoint,
      model: defaultSettings.configs[0].model,
    });
  });

  it("returns cached settings when valid", () => {
    const cached: SettingsState = {
      configs: [
        {
          id: "config-one",
          name: "Primary vLLM",
          provider: "vllm",
          endpoint: "https://vllm.internal",
          model: "mistral:7b",
          apiKey: "abc123",
        },
        {
          id: "config-two",
          name: "Ollama",
          provider: "ollama",
          endpoint: "http://localhost:11434",
          model: "llama3",
          apiKey: "",
        },
      ],
      activeConfigId: "config-two",
      chatOnly: false,
      hiddenToolsDisabled: ["shell"],
    };
    const storage = createMemoryStorage({
      [SETTINGS_KEY]: JSON.stringify(cached),
    });

    const settings = loadSettings(storage);

    expect(settings).toStrictEqual(cached);
  });

  it("upgrades legacy single-config shape", () => {
    const storage = createMemoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        provider: "vllm",
        endpoint: "https://vllm.internal",
        model: "mistral:7b",
        apiKey: "secret",
        chatOnly: false,
        hiddenToolsDisabled: ["shell"],
      }),
    });

    const settings = loadSettings(storage);

    expect(settings.configs).toHaveLength(1);
    expect(settings.activeConfigId).toEqual(settings.configs[0].id);
    expect(settings.chatOnly).toBe(false);
    expect(settings.configs[0]).toMatchObject({
      provider: "vllm",
      endpoint: "https://vllm.internal",
      model: "mistral:7b",
      apiKey: "secret",
    });
  });

  it("falls back to defaults when cache is invalid", () => {
    const storage = createMemoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        configs: [
          {
            id: "bad",
            name: "",
            provider: "",
            endpoint: "",
            model: "",
            apiKey: 1,
          },
        ],
        activeConfigId: "bad",
      }),
    });

    const settings = loadSettings(storage);

    expect(settings).toStrictEqual(defaultSettings);
  });
});

describe("persistSettings", () => {
  it("writes settings to storage with the configured key", () => {
    const storage = createMemoryStorage();
    const next: SettingsState = {
      configs: [
        {
          id: "config-one",
          name: "Local ollama",
          provider: "ollama",
          endpoint: "http://localhost:11434",
          model: "llama3",
          apiKey: "secret",
        },
      ],
      activeConfigId: "config-one",
      chatOnly: true,
      hiddenToolsDisabled: [],
    };

    persistSettings(storage, next);

    expect(storage.store.get(SETTINGS_KEY)).toEqual(JSON.stringify(next));
  });
});
