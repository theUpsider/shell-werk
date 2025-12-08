export interface SettingsState {
  provider: string;
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = "shellwerk:settings";

export const defaultSettings: SettingsState = {
  provider: "mock",
  endpoint: "http://localhost:11434",
  model: "qwen-3",
  apiKey: "",
};

const isValidSettings = (value: unknown): value is SettingsState => {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;
  const provider = maybe.provider;
  const endpoint = maybe.endpoint;
  const model = maybe.model;
  const apiKey = maybe.apiKey;

  return (
    typeof provider === "string" &&
    provider.trim() !== "" &&
    typeof endpoint === "string" &&
    endpoint.trim() !== "" &&
    typeof model === "string" &&
    model.trim() !== "" &&
    (typeof apiKey === "string" || apiKey === undefined)
  );
};

export function loadSettings(storage: SettingsStorage): SettingsState {
  const cached = storage.getItem(SETTINGS_KEY);
  if (!cached) return { ...defaultSettings };

  try {
    const parsed = JSON.parse(cached);
    if (isValidSettings(parsed)) {
      return { ...parsed, apiKey: parsed.apiKey ?? "" };
    }
  } catch {
    // ignore broken cache and fall back to defaults
  }

  return { ...defaultSettings };
}

export function persistSettings(
  storage: SettingsStorage,
  settings: SettingsState
): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
