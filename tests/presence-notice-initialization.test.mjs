import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceAppDir } from "../scripts/lib/config.mjs";
import { patchOriginalLanding } from "../scripts/lib/router-renderer-patch.mjs";
import { createConversationNotice } from "../frontend/src/presence/conversation-notice.ts";

const original = await readFile(path.join(sourceAppDir, "dist/renderer/assets/index-UbX-y3il.js"), "utf8");
const emitted = patchOriginalLanding(original);
const ast = parse(emitted, { ecmaVersion: "latest", sourceType: "module" });
const installation = ast.body.filter(node => node.type === "ExpressionStatement"
  && node.expression.type === "AssignmentExpression"
  && node.expression.left.object?.name === "window"
  && node.expression.left.property?.name === "__beebotConversationNotice");
assert.equal(installation.length, 1, "one actual emitted notice installation");
const assignment = installation[0];
const react = ast.body.find(node => node.type === "VariableDeclaration" && node.declarations.some(item => item.id.name === "S"));
assert.ok(react && react.kind === "var" && assignment.start < react.start, "the actual renderer assigns React after the adapter prefix");
const target = assignment.expression.right;
const helpers = target.type === "Identifier"
  ? ast.body.filter(node => node.type === "FunctionDeclaration" && node.id.name === target.name)
  : [];
assert.ok(helpers.every(node => node.start < react.start));
const prefix = [...helpers, assignment].sort((a, b) => a.start - b.start).map(node => emitted.slice(node.start, node.end)).join("\n");

// Execute the real installation and helper emitted by the packaging adapter in
// their real order. Other desktop initialization is intentionally excluded;
// React and the notice component factory are the real implementations.
test("packaged notices acquire the renderer React only when rendered and reuse it across conversations", () => {
  const receivedReact = [];
  const presence = { createConversationNotice(value) { receivedReact.push(value); return createConversationNotice(value); } };
  const installed = new Function("RPresenceUI", "ReactAPI", "window", "factoryCalls", `
    ${prefix}
    const beforeReactAssignment = factoryCalls();
    var S = ReactAPI;
    return {Notice:window.__beebotConversationNotice,beforeReactAssignment};
  `)(presence, React, {}, () => receivedReact.length);
  assert.equal(installed.beforeReactAssignment, 0, "the prefix must not capture the hoisted undefined React binding");
  for (const surface of ["single-bot", "group-room"]) {
    const entry = Object.freeze({ kind: "notice", id: `${surface}-notice`, code: "delivery_failed", replyTo: `${surface}-message`, text: "Original diagnostic retained" });
    const html = renderToStaticMarkup(React.createElement(installed.Notice, { entry }));
    assert.match(html, /<summary>Handling failed/);
    assert.ok(html.includes(entry.text));
    assert.ok(html.includes(`data-reply-to="${entry.replyTo}"`));
    const ordinary = renderToStaticMarkup(React.createElement(installed.Notice, {
      entry: { ...entry, code: "security_freeze" }, original: React.createElement("aside", null, "Original notice"),
    }));
    assert.equal(ordinary, "<aside>Original notice</aside>");
  }
  assert.deepEqual(receivedReact, [React], "all renders share one factory using the assigned renderer React");
});
