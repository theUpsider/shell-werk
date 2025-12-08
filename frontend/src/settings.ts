const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface SettingsState {
  configs: ModelConfig[];
  activeConfigId: string;
  chatOnly: boolean;
  hiddenToolsDisabled: string[];
  webSearchApiKey: string;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = "shellwerk:settings";

const envVLLMEndpoint =
  (import.meta as { env?: Record<string, string> }).env?.VITE_VLLM_URL ||
  (import.meta as { env?: Record<string, string> }).env?.VITE_VLLM_ENDPOINT ||
  "http://localhost:11434";

const envVLLMApiKey =
  (import.meta as { env?: Record<string, string> }).env?.VITE_VLLM_API_KEY ||
  "";

export const createModelConfig = (
  overrides: Partial<ModelConfig> = {}
): ModelConfig => ({
  id: overrides.id ?? createId(),
  name: overrides.name ?? "Default config",
  provider: overrides.provider ?? "mock",
  endpoint: overrides.endpoint ?? envVLLMEndpoint,
  model: overrides.model ?? "qwen-3",
  apiKey: overrides.apiKey ?? envVLLMApiKey,
});

const defaultConfig = createModelConfig({ id: "config-default" });

export const defaultSettings: SettingsState = {
  configs: [defaultConfig],
  activeConfigId: defaultConfig.id,
  chatOnly: true,
  hiddenToolsDisabled: [],
  webSearchApiKey: "",
};

const isStringArray = (value: unknown): value is string[] => {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
};

const isValidConfig = (value: unknown): value is ModelConfig => {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;

  return (
    typeof maybe.id === "string" &&
    typeof maybe.name === "string" &&
    typeof maybe.provider === "string" &&
    maybe.provider.trim() !== "" &&
    typeof maybe.endpoint === "string" &&
    maybe.endpoint.trim() !== "" &&
    typeof maybe.model === "string" &&
    maybe.model.trim() !== "" &&
    (typeof maybe.apiKey === "string" || maybe.apiKey === undefined)
  );
};

const isValidSettings = (value: unknown): value is SettingsState => {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;

  const configs = maybe.configs;
  const activeConfigId = maybe.activeConfigId;
  const chatOnly = maybe.chatOnly;
  const hiddenToolsDisabled = maybe.hiddenToolsDisabled;
  const webSearchApiKey = maybe.webSearchApiKey;

  return (
    Array.isArray(configs) &&
    configs.every(isValidConfig) &&
    typeof activeConfigId === "string" &&
    (typeof chatOnly === "boolean" || chatOnly === undefined) &&
    (hiddenToolsDisabled === undefined || isStringArray(hiddenToolsDisabled)) &&
    (typeof webSearchApiKey === "string" || webSearchApiKey === undefined)
  );
};

const normalizeSettings = (raw: SettingsState): SettingsState => {
  const validConfigs = raw.configs.filter(isValidConfig);
  const configs = validConfigs.length ? validConfigs : [createModelConfig()];
  const activeConfigId = configs.some((c) => c.id === raw.activeConfigId)
    ? raw.activeConfigId
    : configs[0].id;

  return {
    configs,
    activeConfigId,
    chatOnly: raw.chatOnly ?? defaultSettings.chatOnly,
    hiddenToolsDisabled:
      raw.hiddenToolsDisabled ?? defaultSettings.hiddenToolsDisabled,
    webSearchApiKey: raw.webSearchApiKey ?? defaultSettings.webSearchApiKey,
  };
};

type LegacySettings = {
  provider?: string;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  chatOnly?: boolean;
  hiddenToolsDisabled?: string[];
  webSearchApiKey?: string;
};

const isLegacySettings = (value: unknown): value is LegacySettings => {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;
  return (
    typeof maybe.provider === "string" &&
    typeof maybe.endpoint === "string" &&
    typeof maybe.model === "string"
  );
};

const upgradeLegacySettings = (value: LegacySettings): SettingsState => {
  const config = createModelConfig({
    id: "config-legacy",
    name: "Migrated config",
    provider: value.provider ?? defaultConfig.provider,
    endpoint: value.endpoint ?? defaultConfig.endpoint,
    model: value.model ?? defaultConfig.model,
    apiKey: value.apiKey ?? defaultConfig.apiKey,
  });

  return normalizeSettings({
    configs: [config],
    activeConfigId: config.id,
    chatOnly: value.chatOnly ?? defaultSettings.chatOnly,
    hiddenToolsDisabled:
      value.hiddenToolsDisabled ?? defaultSettings.hiddenToolsDisabled,
    webSearchApiKey: "",
  });
};

export function loadSettings(storage: SettingsStorage): SettingsState {
  const cached = storage.getItem(SETTINGS_KEY);
  if (!cached)
    return {
      ...defaultSettings,
      configs: [...defaultSettings.configs],
    };

  try {
    const parsed = JSON.parse(cached);
    if (isValidSettings(parsed)) return normalizeSettings(parsed);
    if (isLegacySettings(parsed)) return upgradeLegacySettings(parsed);
  } catch {
    // ignore broken cache and fall back to defaults
  }

  return { ...defaultSettings, configs: [...defaultSettings.configs] };
}

export function persistSettings(
  storage: SettingsStorage,
  settings: SettingsState
): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
