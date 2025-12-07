import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { loadAcceptanceCriteria, workspaceRoot } from "./utils/requirements";

const requirementId = "REQ-007";
const [
  playwrightConfigured,
  testsInE2EFolder,
  strictCriterionMapping,
  describePerRequirement,
  localOllamaConfigured,
  functionalityCoverage,
  ciUsesMocks,
] = loadAcceptanceCriteria(requirementId);

const deliveredRequirements = ["REQ-001"];
const e2eDirectory = path.resolve(workspaceRoot, "e2e");

test.describe(`${requirementId}: E2E Testing Infrastructure`, () => {
  test(playwrightConfigured, async ({}, testInfo) => {
    expect(testInfo.config.metadata?.framework).toBe("playwright");
  });

  test(testsInE2EFolder, async ({}, testInfo) => {
    const normalizedTestDir = testInfo.project.testDir.replace(/\\/g, "/");
    expect(normalizedTestDir.endsWith("/e2e")).toBe(true);
    expect(testInfo.file?.includes(`${path.sep}e2e${path.sep}`)).toBe(true);
  });

  test(strictCriterionMapping, async () => {
    const specFiles = fs
      .readdirSync(e2eDirectory)
      .filter((file) => file.endsWith(".spec.ts"));

    for (const specFile of specFiles) {
      const requirement = getRequirementIdFromSpec(specFile);
      if (!requirement) continue;

      const contents = fs.readFileSync(
        path.resolve(e2eDirectory, specFile),
        "utf-8"
      );
      const criteria = loadAcceptanceCriteria(requirement);
      const testCount = countRegex(contents, /\btest\(/g);
      expect(testCount).toBe(criteria.length);
    }
  });

  test(describePerRequirement, async ({}, testInfo) => {
    const [, suiteTitle] = testInfo.titlePath;
    expect(suiteTitle).toBe(`${requirementId}: E2E Testing Infrastructure`);
  });

  test(localOllamaConfigured, async () => {
    const isCI = Boolean(process.env.CI);
    if (isCI) {
      expect(process.env.OLLAMA_PROVIDER).toBe("mock");
      return;
    }

    expect(process.env.OLLAMA_BASE_URL).toBe("http://localhost:11434");
    expect(process.env.OLLAMA_MODEL).toBe("qwen3:4b");
    expect(process.env.OLLAMA_PROVIDER).toBe("ollama");
  });

  test(functionalityCoverage, async () => {
    const specFiles = new Set(
      fs
        .readdirSync(e2eDirectory)
        .filter((file) => file.endsWith(".spec.ts"))
        .map((file) => getRequirementIdFromSpec(file))
        .filter(Boolean)
    );

    for (const requirement of deliveredRequirements) {
      expect(specFiles.has(requirement)).toBe(true);
    }
  });

  test(ciUsesMocks, async () => {
    const isCI = Boolean(process.env.CI);
    const expectedMockFlag = isCI ? "true" : "false";
    expect(process.env.OLLAMA_USE_MOCKS).toBe(expectedMockFlag);
  });
});

function getRequirementIdFromSpec(filename: string): string | null {
  const match = filename.match(/^req-(\d{3})/i);
  if (!match) {
    return null;
  }

  const numericId = match[1];
  return `REQ-${numericId}`;
}

function countRegex(source: string, pattern: RegExp) {
  if (!pattern.global) {
    throw new Error("countRegex expects a global RegExp.");
  }

  return (source.match(pattern) ?? []).length;
}
