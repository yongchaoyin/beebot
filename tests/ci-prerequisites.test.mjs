import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/check.yml", import.meta.url), "utf8");

test("full repository checks hydrate preserved runtime inputs instead of suppressing package tests", () => {
  assert.match(workflow, /runs-on:\s*macos-/);
  assert.match(workflow, /uses: actions\/checkout@[^\n]+\n\s+with:\n\s+lfs: true/);
  const commands = [...workflow.matchAll(/^\s+run: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(commands, [
    "npm ci --no-audit --no-fund", "npm run bootstrap", "npm run icon:generate", "npm run check",
    "npm run frontend:build", "npm run publication:check",
  ]);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|\|\|\s*true/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
});
