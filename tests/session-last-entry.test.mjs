import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { sourceAppDir } from "../scripts/lib/config.mjs";
import { getLastEntryFromTranscript } from "../source/host/extensions/session/session-projection.ts";

// Use the pinned sidebar formatter itself, including its kind table and unknown
// kind handling. A copied array assertion alone would miss renderer contract drift.
const source = await readFile(path.join(sourceAppDir, "dist/renderer/assets/index-UbX-y3il.js"), "utf8");
const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
const declarations = ["Yun", "Zun", "the"].map(name => {
  const matches = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id.name === name);
  assert.equal(matches.length, 1, `one pinned ${name} formatter`);
  return source.slice(matches[0].start, matches[0].end);
});
const tables = ast.body.flatMap(node => node.type === "VariableDeclaration" ? node.declarations : []).filter(node => node.id.name === "mut");
assert.equal(tables.length, 1, "one pinned attachment label table");
const preview = new Function(`${declarations.join("\n")}\nconst ${source.slice(tables[0].start, tables[0].end)};return Zun;`)();
const botFile = (name, batchId, extra = {}) => ({ kind: "send-message", id: name, batchId, message: { type: "attachment", url: `/fixture/${name}`, file_name: name }, ...extra });
const userFile = (name, batchId, extra = {}) => ({ kind: "user-attachment", id: name, batchId, file_path: `/fixture/${name}`, file_name: name, ...extra });

for (const [surface, file] of [["Bot", botFile], ["user", userFile]]) test(`${surface} attachment projection renders through the actual pinned sidebar formatter`, () => {
  const entries = [file("first.png", "batch"), file("second.png", "batch"), file("note.pdf", "batch")];
  const before = JSON.stringify(entries), last = getLastEntryFromTranscript(entries);
  assert.equal(last.kind, "attachment"); assert.equal(last.count, 3);
  assert.deepEqual(last.kinds, [{ kind: "image", count: 2 }, { kind: "document", count: 1 }]);
  assert.equal(preview(last.count, last.kinds), "Sent 3 files · 2 images, 1 document");
  assert.equal(JSON.stringify(entries), before, "building a preview does not modify transcript records");
});

test("attachment grouping, visibility and fallback kinds retain their existing semantics", () => {
  for (const file of [botFile, userFile]) {
    const cases = [
      [[file("earlier.png", "first"), file("latest.pdf", "second")], "Sent 1 document"],
      [[file("visible.png", "batch"), file("hidden.pdf", "batch", { hidden: true }), file("branched.pdf", "batch", { branched: true })], "Sent 1 image"],
      [[file("unknown.extension", "batch")], "Sent 1 file"],
      [[file("unbatched-first.png"), file("unbatched-last.pdf")], "Sent 1 document"],
    ];
    for (const [entries, expected] of cases) {
      const last = getLastEntryFromTranscript(entries);
      assert.equal(preview(last.count, last.kinds), expected);
    }
  }
});

test("ordinary text and HTTPS link projections are unchanged", () => {
  assert.deepEqual(getLastEntryFromTranscript([{ kind: "message", content: "User original" }]), { kind: "text", text: "User original" });
  assert.deepEqual(getLastEntryFromTranscript([{ kind: "send-message", message: { type: "text", content: "Bot original" } }]), { kind: "text", text: "Bot original" });
  assert.deepEqual(getLastEntryFromTranscript([{ kind: "send-message", message: { type: "attachment", url: "https://example.invalid/document" } }]), { kind: "link", url: "https://example.invalid/document" });
});
