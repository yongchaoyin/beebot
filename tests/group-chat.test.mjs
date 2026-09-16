import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadGroupChat() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-group-chat-"));
  const output = path.join(temporary, "group-chat.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/host/groups/group-chat.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

const alice = { id: "a", name: "Alice", description: "researcher" };
const bob = { id: "b", name: "Bob", description: "" };
const room = { name: "股票群", description: "" };

test("a group member is told to talk to the user before doing silent tool work", async () => {
  const loaded = await loadGroupChat();
  try {
    const prompt = loaded.module.buildGroupMemberSystemPrompt(alice, room, [bob]);
    assert.doesNotMatch(prompt, /Do the work first/);
    assert.match(prompt, /SendMessage/);
    assert.match(prompt, /before any other tool|first action|acknowledge/i);
  } finally {
    await loaded.dispose();
  }
});

test("a group turn prompt requires an opening SendMessage when the user just spoke", async () => {
  const loaded = await loadGroupChat();
  try {
    const prompt = loaded.module.buildGroupTurnPrompt({
      member: alice,
      group: room,
      peers: [bob],
      newMessages: [{ speaker: { kind: "user" }, content: "继续呀" }],
      mentioned: true,
    });
    assert.match(prompt, /SendMessage first|before any other tool/i);
  } finally {
    await loaded.dispose();
  }
});

test("a live SendMessage is shown immediately even when no text-delta preview exists", async () => {
  const loaded = await loadGroupChat();
  try {
    assert.equal(
      loaded.module.groupSendMessageStreamPlan({ currentId: undefined }, "收到，我去全A筛一遍"),
      "open-and-seal",
    );
    assert.equal(
      loaded.module.groupSendMessageStreamPlan({ currentId: "t1s0" }, "筛完了"),
      "update-and-seal",
    );
    assert.equal(loaded.module.groupSendMessageStreamPlan({ currentId: undefined }, "(pass)"), "skip");
    assert.equal(loaded.module.groupSendMessageStreamPlan({ currentId: undefined }, "  "), "skip");
  } finally {
    await loaded.dispose();
  }
});

test("a member can post more than two room messages in one turn so an ack does not consume the result", async () => {
  const loaded = await loadGroupChat();
  try {
    assert.ok(loaded.module.GROUP_MAX_MESSAGES_PER_TURN >= 6);
  } finally {
    await loaded.dispose();
  }
});

test("group glue flushes a SendMessage into the room as soon as the tool fires", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    path.join(repoRoot, "source/host/extensions/transcript/group-chat-glue.ts"),
    "utf8",
  );
  assert.match(source, /groupSendMessageStreamPlan/);
  assert.match(source, /open-and-seal/);
});
