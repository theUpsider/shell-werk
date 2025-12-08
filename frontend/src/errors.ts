export function describeError(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof Error) {
    return err.message || fallback;
  }
  if (typeof err === "string") {
    return err || fallback;
  }
  if (err && typeof err === "object") {
    if (
      "message" in err &&
      typeof (err as { message?: unknown }).message === "string"
    ) {
      return (err as { message: string }).message || fallback;
    }
    if ("error" in err && typeof (err as { error?: unknown }).error === "string") {
      return (err as { error: string }).error || fallback;
    }
    try {
      const serialized = JSON.stringify(err);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // ignore JSON issues and fall back
    }
  }
  return fallback;
}

export function formatProviderTarget(
  provider?: string,
  endpoint?: string
): string {
  const trimmedProvider = (provider ?? "").trim();
  const trimmedEndpoint = (endpoint ?? "").trim();

  if (trimmedProvider && trimmedEndpoint) {
    return `${trimmedProvider} @ ${trimmedEndpoint}`;
  }
  if (trimmedProvider) return trimmedProvider;
  if (trimmedEndpoint) return trimmedEndpoint;
  return "";
}
