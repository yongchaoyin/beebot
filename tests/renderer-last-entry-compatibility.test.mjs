import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { getLastEntryFromTranscript } from "../source/host/extensions/session/session-projection.ts";

// Bundle the actual readable renderer parser, including its real dependencies;
// the Host projection above is also imported directly rather than reimplemented.
const compiled = await build({
  stdin: {
    contents: 'export { parseRendererAgentLastEntry, projectRendererAgent } from "./frontend/src/production/model.ts";',
    resolveDir: path.resolve(import.meta.dirname, ".."),
  },
  bundle: true, write: false, platform: "node", format: "cjs", target: "node26", packages: "external",
});
const bundled = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { parseRendererAgentLastEntry, projectRendererAgent } = bundled.exports;
const attachment = kinds => ({ kind: "attachment", count: 3, kinds });

for (const actor of ["Bot", "user"]) test(`${actor} Host attachment summaries reach the readable renderer without losing their preview`, () => {
  const files = ["first.png", "second.png", "note.pdf"];
  const transcript = files.map(name => actor === "Bot"
    ? { kind: "send-message", batchId: "fixture-batch", message: { type: "attachment", file_name: name, url: `/fixture/${name}` } }
    : { kind: "user-attachment", batchId: "fixture-batch", file_name: name, file_path: `/fixture/${name}` });
  const host = getLastEntryFromTranscript(transcript), before = structuredClone(host);
  assert.deepEqual(host.kinds, [{ kind: "image", count: 2 }, { kind: "document", count: 1 }]);
  const expected = attachment({ image: 2, document: 1 });
  assert.deepEqual(parseRendererAgentLastEntry(host), expected);
  for (const isGroup of [false, true]) {
    const agent = projectRendererAgent({ id: "fixture-bot", name: "Fixture", isGroup, lastEntry: host }, 0);
    assert.deepEqual(agent.lastEntry, expected, "single-Bot and Group list projections retain attachment metadata");
    assert.equal(agent.lastMessage, "Sent 3 files");
  }
  assert.deepEqual(host, before, "normalization does not rewrite the Host summary");
});

test("legacy kind records and current kind arrays normalize to the same record view model", () => {
  const old = Object.freeze(attachment(Object.freeze({ image: 2, document: 1 })));
  const current = Object.freeze(attachment(Object.freeze([
    Object.freeze({ kind: "image", count: 1 }), Object.freeze({ kind: "document", count: 1 }), Object.freeze({ kind: "image", count: 1 }),
  ])));
  assert.deepEqual(parseRendererAgentLastEntry(old), old);
  assert.deepEqual(parseRendererAgentLastEntry(current), old, "duplicate array kinds are merged without dropping their counts");
  for (const kinds of [[], {}]) assert.deepEqual(parseRendererAgentLastEntry(attachment(kinds)), attachment({}));
  for (const kinds of [[{ kind: "future-kind", count: 3 }], { "future-kind": 3 }]) {
    assert.deepEqual(parseRendererAgentLastEntry(attachment(kinds)), attachment({ "future-kind": 3 }), "unknown kinds retain the existing file fallback");
  }
});

test("malformed kind items fail closed instead of displaying a partial attachment summary", () => {
  const invalid = [null, undefined, "image", 3, [null], [["image", 1]], [{}], [{ kind: "image" }], [{ count: 1 }],
    [{ kind: 1, count: 1 }], [{ kind: "", count: 1 }], { "": 1 }, [{ kind: "image", count: "1" }],
    [{ kind: "image", count: 0 }], [{ kind: "image", count: -1 }], [{ kind: "image", count: 1.5 }],
    [{ kind: "image", count: NaN }], [{ kind: "image", count: Infinity }], { image: "1" }, { image: 0 },
    { image: -1 }, { image: 1.5 }, { image: NaN }, { image: Infinity }, new Array(1),
    [{ kind: "image", count: 1 }, { kind: "document", count: 0 }],
    [Object.create({ kind: "image", count: 1 })],
    [{ kind: "image", count: Number.MAX_SAFE_INTEGER }, { kind: "image", count: 1 }],
  ];
  for (const kinds of invalid) assert.equal(parseRendererAgentLastEntry(attachment(kinds)), null);
});

test("prototype keys are rejected in either wire format without changing any object prototype", () => {
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  for (const kind of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
    for (const kinds of [[{ kind, count: 3 }], JSON.parse(JSON.stringify({ [kind]: 3 }))]) {
      assert.equal(parseRendererAgentLastEntry(attachment(kinds)), null, kind);
    }
  }
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototype);
  const normalized = parseRendererAgentLastEntry(attachment([{ kind: "image", count: 3 }])).kinds;
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
  assert.deepEqual(Object.keys(normalized), ["image"]);
});

test("ordinary text and link entries keep their existing representation", () => {
  for (const entry of [{ kind: "text", text: "Original message" }, { kind: "link", url: "https://example.invalid/fixture" }]) {
    assert.deepEqual(parseRendererAgentLastEntry(entry), entry);
  }
});
