import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../scripts/lib/sand-group-ui.snippet.js", import.meta.url), "utf8");
function helpers() {
  const sandbox = vm.createContext({ window: { __sandGroupUiBound: true } });
  vm.runInContext(source, sandbox);
  return sandbox;
}
for (const [text, caret, expected] of [
  ["@小", 2, { start: 0, query: "小" }],
  ["先看 @Re 后面别删", 6, { start: 3, query: "Re" }],
  ["user@example.com", 16, null],
  ["`@Writer", 8, null],
  ["> @Writer", 9, null],
  ["@Writer done", 12, null],
]) test(`mention query at caret: ${text}`, () => {
  const context = helpers();
  assert.equal(JSON.stringify(context.RMentionQuery(text, caret)), JSON.stringify(expected));
});

test("duplicate display names use exact member IDs, unique names remain readable", () => {
  const context = helpers();
  const members = [{ id: "a", name: "小林" }, { id: "b", name: "小林" }, { id: "c", name: "Bob Smith" }];
  assert.equal(context.RMentionToken(members[0], members), "@{a}");
  assert.equal(context.RMentionToken(members[1], members), "@{b}");
  assert.equal(context.RMentionToken(members[2], members), "@Bob Smith");
});

test("reserved names and markup use IDs instead of accidentally broadcasting", () => {
  const context = helpers();
  for (const name of ["all", "everyone", "所有人", "全体", "A`B", "A@B", "A{B}"]) {
    const member = { id: "a", name };
    assert.equal(context.RMentionToken(member, [member]), "@{a}");
  }
});
