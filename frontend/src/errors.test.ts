import { describe, expect, it } from "vitest";
import { describeError, formatProviderTarget } from "./errors";

describe("describeError", () => {
  it("returns message from Error instances", () => {
    const err = new Error("boom");
    expect(describeError(err)).toBe("boom");
  });

  it("returns string input unchanged", () => {
    expect(describeError("plain failure")).toBe("plain failure");
  });

  it("prefers message field on objects", () => {
    expect(describeError({ message: "detailed issue" })).toBe("detailed issue");
  });

  it("falls back to error field when present", () => {
    expect(describeError({ error: "server unavailable" })).toBe(
      "server unavailable"
    );
  });

  it("returns fallback when details are missing", () => {
    expect(describeError({})).toBe("Unknown error");
  });
});

describe("formatProviderTarget", () => {
  it("includes provider and endpoint when both are present", () => {
    expect(formatProviderTarget("ollama", "http://localhost:11434")).toBe(
      "ollama @ http://localhost:11434"
    );
  });

  it("returns provider when endpoint is absent", () => {
    expect(formatProviderTarget("vllm", "")).toBe("vllm");
  });

  it("returns endpoint when provider is absent", () => {
    expect(formatProviderTarget("", "http://example.test")).toBe(
      "http://example.test"
    );
  });

  it("returns empty string when nothing is provided", () => {
    expect(formatProviderTarget()).toBe("");
  });
});
