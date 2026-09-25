import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { patchOriginalLanding } from "../scripts/lib/router-renderer-patch.mjs";

// Exercise the shipped roster's TWO-argument adapter, not a replacement of
// window.__sandUpdateAgent. Transport and roster UI bookkeeping are controlled;
// profile writes, SQLite summaries, settings publication and model resolution
// below use the real Host implementations. No paid model or live user data.
const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "bb-rebind-contract-"));
after(() => rmSync(temp, { recursive: true, force: true }));
const entry = path.join(temp, "entry.ts"), output = path.join(temp, "host.cjs");
writeFileSync(entry, ["host/extensions/transcript/agent-lifecycle", "host/extensions/session/agent-session", "host/extensions/inference/resolve-inference", "host/agents/agent-profile", "shared/node/settings/sand-settings-store", "shared/node/local-inference-snapshot", "electron-main/main-edge"].map(p => `export * from ${JSON.stringify(path.join(root, "source", p + ".ts"))};`).join("\n"));
await build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", outfile: output, logLevel: "silent", external: ["tree-sitter", "tree-sitter-bash"] });
const host = createRequire(import.meta.url)(output);
const original = readFileSync(path.join(root, "src/app/dist/renderer/assets/index-UbX-y3il.js"), "utf8");
const shipped = patchOriginalLanding(original);
const overlay = readFileSync(path.join(root, "scripts/lib/sand-create-overlay.snippet.js"), "utf8");
const selectorStart = overlay.indexOf("function RSyncVendorChoices(");
const selectorEnd = overlay.indexOf("},1200)}", selectorStart) + 9;
const selectorScript = overlay.slice(selectorStart, selectorEnd);
const declarations = parse(shipped, { ecmaVersion: "latest", sourceType: "module" }).body;
const mon = declarations.find(n => n.type === "FunctionDeclaration" && n.id.name === "MOn");
const roster = declarations.find(n => n.type === "FunctionDeclaration" && n.id.name === "hHn");
assert.ok(mon && roster, "pinned model bridge and roster anchors must exist");
let update, dispatch;
simple(roster, {
  VariableDeclarator(node) { if (node.id.name === "Te") update = shipped.slice(node.init.start, node.init.end); },
  Property(node) { if (node.key.name === "updateAgent" && node.value.type === "ArrowFunctionExpression") dispatch = shipped.slice(node.value.start, node.value.end); }
});
assert.ok(update && dispatch, "actual public updateAgent adapter and RPC forwarding required");
const bind = new Function("window", "S", "lr", shipped.slice(mon.start, mon.end) + ";return MOn;");
const lookup = declarations.find(n => n.type === "FunctionDeclaration" && n.id.name === "RAgentVendorId");
const lookupBody = shipped.slice(lookup.start, lookup.end);

function connect(source, window = {}) {
  const events = [];
  const updateAgent = new Function("e", "ue", "de", "fe", "a9e", `let E=0; const l=new Map(); const Te=${update}; return ${dispatch};`)(source, (...a) => events.push(["optimistic", ...a]), (...a) => events.push(["settled", ...a]), () => {}, () => false);
  const value = { updateAgent, snapshots: { get: () => ({ agents: { rows: source.rows ?? [] } }) }, deleteAgents: () => {} };
  bind(window, { useCallback: fn => fn, useMemo: fn => fn() }, run => ({ run, isPending: false }))({ roster: value });
  return { window, roster: value, events, lookup: id => new Function("window", lookupBody + ";return RAgentVendorId;")(window)(id) };
}

for (const room of ["single", "group"]) {
  test(`${room}: shipped settings bridge persists the intended Bot then resolves its exact configured API`, async t => {
    const directory = mkdtempSync(path.join(temp, room + "-"));
    const settingsPath = path.join(directory, "settings.json"), settings = new host.SandSettingsStore(settingsPath);
    const edge = host.createMainEdgeHandlers({ settingsStore: settings, onboardingSeen: { apply() {} }, cursorAccount: { syncPresentedAuth() {} }, syncHostSettingsToBox: async v => v });
    const a = await edge.upsertInferenceVendor({ provider: "custom", label: "A", baseUrl: "https://model.example.test/v1", modelId: "model-a", apiKey: "fixture-key-a" });
    const b = await edge.upsertInferenceVendor({ provider: "custom", label: "B", baseUrl: "https://other.example.test/v1", modelId: "model-b", apiKey: "fixture-key-b" });
    const chosen = b.vendors.find(v => v.label === "B").id;
    const store = new host.SandAgentSessionStore(path.join(directory, "agents"));
    const member = await store.createSession({ name: "艾克", description: "保留职责", avatarShape: "cloud", avatarColor: "green", inferenceVendorId: "deleted-api" });
    const other = await store.createSession({ name: "同事", inferenceVendorId: a.defaultVendorId });
    t.after(() => { member.db.close(); other.db.close(); });
    const originalProfile = store.getAgentProfileText(other.id);
    const active = room === "single" ? member : other;
    const tm = { sessionStore: store, sessions: { activeSession: active }, roster: { reserveSnapshotStamp: () => 1, async emitAgentUpdate() {}, emitProfileChanged() {}, finalizeSummaryForRpc: summary => summary } };
    const lifecycle = new host.AgentLifecycle(tm), received = [];
    let completion;
    const source = { rows: [{ id: member.id, inferenceVendorId: "deleted-api" }], async updateAgent(args) {
      received.push(args); completion = lifecycle.updateAgent(args.id, args.profile);
      const summary = await completion; this.rows = [summary]; return summary;
    } };
    const window = new Window({ url: "https://beebot.test", settings: { enableJavaScriptEvaluation: true } });
    t.after(() => window.happyDOM.close());
    window.document.body.innerHTML = `<main data-beebot-settings-owner="${member.id}"><section class="sand-agent-settings"><input value="艾克"><textarea>保留职责</textarea></section></main><input id="draft" value="保留未发草稿">`;
    window.RCreateText = (zh, en) => en;
    window.desktop = { agent: { getInferenceVendors: async () => ({ vendors: settings.getInferenceVendors(), defaultVendorId: settings.getDefaultInferenceVendorId() }) } };
    let poll; window.setInterval = callback => (poll = callback, 1);
    const api = connect(source, window);
    window.eval(lookupBody + "\n" + selectorScript);
    const previousRoot = process.env.SAND_DATA_ROOT, previousSnapshot = process.env.BEEBOT_LOCAL_INFERENCE_SNAPSHOT;
    process.env.SAND_DATA_ROOT = directory;
    process.env.BEEBOT_LOCAL_INFERENCE_SNAPSHOT = path.join(host.localInferenceDirectory(settingsPath), "current.json");
    try {
      assert.throws(() => host.resolveInferenceForAgent(member.id), { name: "MissingInferenceVendorError" });
      await poll();
      const select = window.document.querySelector("#sand-agent-vendor select");
      assert.equal(select.value, "deleted-api");
      select.value = chosen; select.dispatchEvent(new window.Event("change"));
      for (let i = 0; i < 20 && !completion; i++) await Promise.resolve();
      assert.ok(completion, "actual selector reached the Host");
      const saved = await completion;
      for (let i = 0; i < 20; i++) await Promise.resolve();
      assert.match(window.document.querySelector('[role="status"]').textContent, /Saved/);
      assert.equal(window.document.getElementById("draft").value, "保留未发草稿");
      assert.deepEqual(JSON.parse(JSON.stringify(received)), [{ id: member.id, profile: { name: "艾克", inferenceVendorId: chosen } }]);
      assert.equal(saved.id, member.id); assert.equal(saved.inferenceVendorId, chosen);
      assert.equal(store.getAgentProfileText(member.id).description, "保留职责");
      assert.equal(store.getAgentProfileText(member.id).avatarShape, "cloud");
      assert.deepEqual(store.getAgentProfileText(other.id), originalProfile);
      const nextTurn = host.resolveInferenceForAgent(member.id);
      assert.equal(nextTurn.vendor.id, chosen);
      assert.equal(host.snapshotHttpSession(host.readLocalInferenceSnapshot(), nextTurn.provider, nextTurn.vendor).apiKey, "fixture-key-b");
      // Fresh store + production resolver simulate the next turn/reopen, not a UI cache.
      assert.equal(new host.SandAgentSessionStore(store.rootDir).getAgentProfileText(member.id).inferenceVendorId, chosen);
    } finally {
      if (previousRoot === undefined) delete process.env.SAND_DATA_ROOT; else process.env.SAND_DATA_ROOT = previousRoot;
      if (previousSnapshot === undefined) delete process.env.BEEBOT_LOCAL_INFERENCE_SNAPSHOT; else process.env.BEEBOT_LOCAL_INFERENCE_SNAPSHOT = previousSnapshot;
    }
  });
}

test("bridge preserves host rejection; the real roster adapter rolls back rather than confirming", async () => {
  const error = new Error("Host offline"), x = connect({ updateAgent: async () => { throw error; } });
  await assert.rejects(x.window.__sandUpdateAgent("bot-a", { name: "A", inferenceVendorId: "v1" }), e => e === error);
  assert.deepEqual(x.events.at(-1), ["settled", "bot-a", 0, "rollback"]);
});

test("fresh roster identity invalidates previous bindings and authoritative rows win over cache", () => {
  const window = { __sandAgentVendors: { "bot-a": "stale-api" } };
  const a = connect({ rows: [{ id: "bot-a", inferenceVendorId: "api-a" }] }, window);
  assert.equal(a.lookup("bot-a"), "api-a");
  window.__sandAgentVendors["bot-a"] = "stale-api";
  assert.equal(a.lookup("bot-a"), "api-a");
  const b = connect({ rows: [{ id: "bot-a", inferenceVendorId: "api-b" }] }, window);
  assert.equal(b.lookup("bot-a"), "api-b");
  assert.equal(Object.keys(window.__sandAgentVendors).length, 0);
});
