import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { transform } from "esbuild";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import path from "node:path";

const marker = /cursor|grok(?:[ _-]*bot)?/ig;
const profileFile = "source/electron-main/startup/windows-user-data-migration.ts";

/** Inventory categories are explanations, not a claim that integrations are dead.
 * Normal CSS cursor, pagination and editor coordinates are not brand identities. */
export function classifyIdentityReference(file, text) {
  if (/^(?:LICENSE|NOTICE|PROVENANCE)|\/evidence(?:\.|\/)|\/EVIDENCE\./i.test(file)) return "attribution-or-reconstruction-evidence";
  if (/^(?:research-archives|manifests)\//.test(file) || /\/generated\//.test(file)) return "pinned-input-or-wire-schema";
  if (/^(?:docs|tests)\//.test(file)) return "documentation-or-regression-fixture";
  if (file === profileFile || file === "src/app/package.json" || /process-metrics\/redaction/.test(file)) return "persisted-identity-compatibility";
  if (/--cursor-|cursor-(?:icons|light|dark)|["']cursor-logo["']/.test(text)) return "renderer-theme-or-glyph-compatibility";
  if (/Cursor[A-Z]|cursorAccount|cursor-auth|cursor-backend|cursor\.com|cursor\.sh|Cursor (?:account|cloud|session|backend)|grokbot|grok-bot|Grok Bot/.test(text)) return "live-integration-or-build-dependency-review";
  return "generic-cursor-or-model-identifier-review";
}

export async function inspectProductAliases(file, content) {
  if (!file.startsWith("source/") && !file.startsWith("frontend/src/")) return [];
  if (/\/generated\/|\/evidence\.|\.gen\.ts$/.test(file) || file === profileFile) return [];
  if (!/\.(?:ts|tsx|js|mjs)$/.test(file) || !/Grok Bot/.test(content)) return [];
  const { code } = await transform(content, { loader: file.endsWith("tsx") ? "tsx" : "ts", format: "esm", legalComments: "none" });
  const findings = [];
  simple(parse(code, { ecmaVersion: "latest", sourceType: "module" }), {
    Literal(node) {
      if (typeof node.value === "string" && /Grok Bot/.test(node.value) && !/copyright|licensed|all rights reserved/i.test(node.value)) findings.push({ file, text: node.value.slice(0, 240) });
    },
    TemplateElement(node) {
      if (/Grok Bot/.test(node.value.raw) && !/copyright|licensed|all rights reserved/i.test(node.value.raw)) findings.push({ file, text: node.value.raw.slice(0, 240) });
    },
  });
  return findings;
}

/** Only indexed project files: never scan user data, secrets, node_modules or caches. */
export async function auditProductIdentity(root) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const matches = [], violations = [];
  for (const file of files) {
    if (!/\.(?:ts|tsx|js|mjs|cjs|json|css|html|md|yml|yaml|svg|txt)$/.test(file)) {
      if (file.match(marker)) matches.push({ file, category: "binary-input-or-glyph-review", count: 1, examples: ["Filename match; binary content is not represented as text"] });
      continue;
    }
    const content = await readFile(path.join(root, file), "utf8");
    violations.push(...await inspectProductAliases(file, content));
    const lines = content.split("\n"); const categories = new Map();
    for (let i = 0; i < lines.length; i++) {
      const hits = lines[i].match(marker); if (!hits) continue;
      const category = classifyIdentityReference(file, lines[i]);
      const group = categories.get(category) ?? { file, category, count: 0, examples: [] };
      group.count += hits.length;
      if (group.examples.length < 2) group.examples.push({ line: i + 1, text: lines[i].trim().slice(0, 220) });
      categories.set(category, group);
    }
    matches.push(...categories.values());
  }
  const counts = {};
  for (const row of matches) counts[row.category] = (counts[row.category] ?? 0) + row.count;
  return { schemaVersion: 1, indexedFiles: files.length, filesWithReferences: new Set(matches.map(row => row.file)).size, violations, counts, matches,
    scope: "Tracked source, metadata and filenames. Categories ending in review require dependency review; they are not approved deletions. Compiled output and binary artwork have separate integrity tests." };
}
