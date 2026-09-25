import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { transform } from "esbuild";
import { conversationNoticeSummary, createConversationNotice } from "../frontend/src/presence/conversation-notice.ts";
import { patchConversationNoticeChunk } from "../scripts/lib/conversation-notice-patch.mjs";

const raw = "艾克：此次处理失败，消息已保留。请核查已有操作后引用原消息继续。 / This request failed. Review prior actions before continuing.";
const entry = { kind: "notice", id: "notice-a", code: "delivery_failed", replyTo: "message-a", text: raw };
const Component = createConversationNotice(React);

test("known generated failure notice is compact but retains the complete source and original reference", () => {
  const before = JSON.stringify(entry);
  const html = renderToStaticMarkup(createElement(Component, { entry }));
  assert.match(html, /<details/); assert.match(html, /<summary>Handling failed/);
  assert.ok(html.includes(raw)); assert.match(html, /data-reply-to="message-a"/);
  assert.equal(JSON.stringify(entry), before);
  assert.match(conversationNoticeSummary(entry, "zh"), /继续前请核查/);
  assert.doesNotMatch(conversationNoticeSummary(entry, "zh"), /This request/);
});

test("ordinary notices and quoted/user-authored lookalike failures are never compacted by text matching", () => {
  for (const copy of [{ ...entry, code: undefined }, { ...entry, code: "security_freeze" }, { ...entry, kind: "message" }]) {
    assert.equal(conversationNoticeSummary(copy, "en"), null);
  }
  const html = renderToStaticMarkup(createElement(Component, { entry: { ...entry, code: "security_freeze" }, original: createElement("aside", null, "Exact original card") }));
  assert.equal(html, "<aside>Exact original card</aside>");
});

test("the actual shipped lazy notice card uses the shared display without changing stored records", async () => {
  const rawChunk = await readFile("src/app/dist/renderer/assets/view-1r0bwdK4.js", "utf8");
  const patched = patchConversationNoticeChunk(rawChunk);
  await transform(patched, { loader: "js", format: "esm" });
  assert.match(patched, /__beebotConversationNotice/);
  assert.match(patched, /original:c.jsx\(ROriginalNotice,n\)/);
  assert.match(patched, /export\{m as default\}/);
  assert.throws(() => patchConversationNoticeChunk(rawChunk + "\n/* changed */"), /differs/);
});

test("density styles retain virtualization, native caption and controls rather than hiding content", async () => {
  const css = await readFile("frontend/src/presence/chat-density.css", "utf8");
  assert.match(css, /\.sand-virtual-transcript__row\s*\{[^}]*margin-block: 0 !important;[^}]*padding-block: 5px !important;/);
  assert.doesNotMatch(css, /transform\s*:|display\s*:\s*none|visibility\s*:\s*hidden|position\s*:/);
  assert.match(css, /:has\(> \.sand-routine__empty\)/);
  assert.match(css, /\.sand-tray-stack\s*\{[^}]*overflow-y: auto/);
  assert.match(await readFile("frontend/src/presence/presence.css", "utf8"), /@import "\.\/chat-density.css"/);
});
