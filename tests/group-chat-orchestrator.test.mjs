import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadOrchestrator() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-group-orch-"));
  const output = path.join(temporary, "group-chat-orchestrator.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/transcript/group-chat-orchestrator.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

function members() {
  return [
    { id: "a", name: "Alice", description: "" },
    { id: "b", name: "Bob", description: "" },
  ];
}

test("group members start speaking at the same time instead of waiting their turn", async () => {
  const loaded = await loadOrchestrator();
  try {
    const started = [];
    const spoken = new Set();
    const history = [{ speaker: { kind: "user" }, content: "hi everyone" }];
    let overlapping = 0;
    let inFlight = 0;
    const orchestrator = new loaded.module.GroupChatOrchestrator({
      resolveMembers: async () => members(),
      readHistory: () => history,
      isCurrent: () => true,
      runMemberTurn: async ({ member }) => {
        started.push(member.id);
        inFlight += 1;
        if (inFlight > 1) overlapping += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight -= 1;
        if (spoken.has(member.id)) return ["(pass)"];
        spoken.add(member.id);
        return [`${member.name} here`];
      },
      postMemberMessage: (member, content) => {
        history.push({ speaker: { kind: "member", id: member.id, name: member.name }, content });
      },
    });
    await orchestrator.run({ group: { name: "Room", description: "" }, memberIds: ["a", "b"] });
    assert.ok(overlapping > 0, "both members should be in flight together");
    assert.deepEqual(new Set(started.slice(0, 2)), new Set(["a", "b"]));
  } finally {
    await loaded.dispose();
  }
});

test("after seeing others speak, members can add a follow-up", async () => {
  const loaded = await loadOrchestrator();
  try {
    const history = [{ speaker: { kind: "user" }, content: "plan the launch" }];
    const calls = { a: 0, b: 0 };
    const orchestrator = new loaded.module.GroupChatOrchestrator({
      resolveMembers: async () => members(),
      readHistory: () => history,
      isCurrent: () => true,
      runMemberTurn: async ({ member }) => {
        calls[member.id] += 1;
        if (member.id === "a" && calls.a <= 4) return [`Alice ${calls.a}`];
        if (member.id === "b" && calls.b === 1) return ["Bob first"];
        if (member.id === "b" && calls.b === 2) return ["Bob follow-up"];
        return ["(pass)"];
      },
      postMemberMessage: (member, content) => {
        history.push({ speaker: { kind: "member", id: member.id, name: member.name }, content });
      },
    });
    await orchestrator.run({ group: { name: "Room", description: "" }, memberIds: ["a", "b"] });
    assert.ok(calls.a >= 4, "follow-ups are not capped at three round-robin rounds");
    assert.ok(history.some((entry) => entry.content === "Bob follow-up"));
  } finally {
    await loaded.dispose();
  }
});

test("one member throwing does not silence the others", async () => {
  const loaded = await loadOrchestrator();
  try {
    const history = [{ speaker: { kind: "user" }, content: "hi" }];
    const posted = [];
    const spoken = new Set();
    const orchestrator = new loaded.module.GroupChatOrchestrator({
      resolveMembers: async () => members(),
      readHistory: () => history,
      isCurrent: () => true,
      runMemberTurn: async ({ member }) => {
        if (member.id === "a") throw new Error("Alice crashed");
        if (spoken.has(member.id)) return ["(pass)"];
        spoken.add(member.id);
        return ["Bob made it"];
      },
      postMemberMessage: (member, content) => {
        posted.push(content);
        history.push({ speaker: { kind: "member", id: member.id, name: member.name }, content });
      },
    });
    await orchestrator.run({ group: { name: "Room", description: "" }, memberIds: ["a", "b"] });
    assert.deepEqual(posted, ["Bob made it"]);
  } finally {
    await loaded.dispose();
  }
});

test("the room goes quiet when nobody has more to add", async () => {
  const loaded = await loadOrchestrator();
  try {
    const history = [{ speaker: { kind: "user" }, content: "ok" }];
    let waves = 0;
    const orchestrator = new loaded.module.GroupChatOrchestrator({
      resolveMembers: async () => members(),
      readHistory: () => history,
      isCurrent: () => true,
      runMemberTurn: async () => {
        waves += 1;
        return ["(pass)"];
      },
      postMemberMessage: () => {
        throw new Error("pass must not post");
      },
    });
    await orchestrator.run({ group: { name: "Room", description: "" }, memberIds: ["a", "b"] });
    assert.equal(waves, 2, "one concurrent wave of two members, then stop");
  } finally {
    await loaded.dispose();
  }
});
