import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const workspaceRoot = path.resolve(__dirname, "..", "..");

const cache = new Map<string, string[]>();

export function loadAcceptanceCriteria(requirementId: string): string[] {
  const cached = cache.get(requirementId);
  if (cached) {
    return cached;
  }

  const requirementPath = path.resolve(
    workspaceRoot,
    "docs",
    "requirements",
    `${requirementId}.md`
  );
  const contents = fs.readFileSync(requirementPath, "utf-8");
  const matches = Array.from(contents.matchAll(/- \[[ xX]\] (.+)/g)).map(
    (match) => match[1].trim()
  );

  if (!matches.length) {
    throw new Error(`No acceptance criteria found for ${requirementId}`);
  }

  cache.set(requirementId, matches);
  return matches;
}

export function assertMatchesAcceptanceCriterion(
  requirementId: string,
  criterion: string
) {
  const criteria = loadAcceptanceCriteria(requirementId);
  if (!criteria.includes(criterion.trim())) {
    throw new Error(
      `Criterion "${criterion}" is not defined for requirement ${requirementId}.`
    );
  }
}
