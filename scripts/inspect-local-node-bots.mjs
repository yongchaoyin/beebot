// Read-only inspection of the two local demo nodes. No auth database, token,
// gateway credential, conversation text, or production secret is read.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const hash = value => createHash("sha256").update(value).digest("hex");
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  const value = process.argv[index + 1];
  if (!["--expect-a", "--expect-b", "--baseline"].includes(flag) || value === undefined || options[flag] !== undefined) {
    throw new Error("Usage: node scripts/inspect-local-node-bots.mjs [--expect-a COUNT] [--expect-b COUNT] [--baseline PREVIOUS_REPORT.json]");
  }
  if (flag !== "--baseline" && !/^(?:[0-9]|[1-4][0-9]|50)$/.test(value)) throw new Error("Expected Bot counts must be between 0 and 50");
  options[flag] = value;
}

async function readNodeFiles(demoNode) {
  const { DatabaseSync } = await import("node:sqlite");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { createHash } = await import("node:crypto");
  const root = "/var/lib/beebot-node";
  const sha = value => createHash("sha256").update(value).digest("hex");
  function optionalJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  }
  function artifact(file) {
    try { const value = fs.readFileSync(file, "utf8"); return { value, digest: sha(value) }; }
    catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, "node.json"), "utf8"));
  if (config.name !== `BeeBot Docker ${demoNode.toUpperCase()}`) throw new Error("Container is not the expected demo node");
  const db = new DatabaseSync(path.join(root, "control.sqlite"), { readOnly: true });
  let bots;
  let goals;
  try {
    db.exec("PRAGMA query_only=ON");
    bots = db.prepare("SELECT id, json_extract(data, '$.name') AS name FROM bots ORDER BY rowid").all();
    goals = db.prepare("SELECT id, json_extract(data, '$.botId') AS botId, json_extract(data, '$.status') AS status FROM goals ORDER BY rowid").all();
  } finally { db.close(); }
  return {
    nodeId: config.nodeId, name: config.name, publicUrl: config.publicUrl,
    bots: bots.map(bot => {
      const dataDir = path.join(root, "runtime-bots", sha(bot.id));
      const hostDir = path.join(dataDir, "host");
      const workspaceDir = path.join(hostDir, "box-workspace");
      const mapping = optionalJson(path.join(dataDir, "agent.json"));
      if (mapping && (mapping.botId !== bot.id || !/^[a-f0-9-]{36}$/.test(mapping.agentId))) throw new Error("Bot has an invalid runtime identity mapping");
      const agentStore = mapping ? path.join(hostDir, "agents", mapping.agentId, "store.db") : null;
      const environment = artifact(path.join(workspaceDir, "environment.txt"));
      const platform = artifact(path.join(workspaceDir, "platform.txt"));
      const runs = artifact(path.join(workspaceDir, "runs.txt"));
      const statusCounts = {};
      for (const goal of goals.filter(goal => goal.botId === bot.id)) statusCounts[goal.status] = (statusCounts[goal.status] ?? 0) + 1;
      return {
        id: bot.id, name: bot.name, hostAgentId: mapping?.agentId ?? null,
        dataDir, hostDir, workspaceDir,
        workspaceRealPath: fs.existsSync(workspaceDir) ? fs.realpathSync(workspaceDir) : null,
        agentStore, runtimeReady: Boolean(agentStore && fs.existsSync(agentStore) && fs.existsSync(workspaceDir)),
        artifacts: {
          environment: environment ? environment.value.trim() === `node-${demoNode}` ? `node-${demoNode}` : "unexpected content" : null,
          platform: platform ? platform.value.trim() === "Linux" ? "Linux" : "unexpected content" : null,
          runLines: runs ? runs.value.split(/\r?\n/).filter(line => line.length > 0).length : 0,
          fingerprint: sha(JSON.stringify([environment?.digest ?? null, platform?.digest ?? null, runs?.digest ?? null])),
        },
        goalStatusCounts: statusCounts,
      };
    }),
    goals,
  };
}

const entries = await Promise.all(["a", "b"].map(async demoNode => {
  const container = `beebot-demo-${demoNode}`;
  const source = `console.log(JSON.stringify(await (${readNodeFiles.toString()})(${JSON.stringify(demoNode)})));`;
  const { stdout } = await run("docker", ["exec", container, "node", "--input-type=module", "-e", source], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return [demoNode, { container, ...JSON.parse(stdout) }];
}));
const nodes = Object.fromEntries(entries);
assert.notEqual(nodes.a.nodeId, nodes.b.nodeId, "Demo nodes must have separate persistent identities");
const allBots = Object.values(nodes).flatMap(node => node.bots);
assert.equal(new Set(allBots.map(bot => bot.id)).size, allBots.length, "Bot IDs must be distinct");
const initialized = allBots.filter(bot => bot.runtimeReady);
assert.equal(new Set(initialized.map(bot => bot.hostAgentId)).size, initialized.length, "Each initialized Bot must keep a distinct Host agent identity");
for (const [demoNode, node] of Object.entries(nodes)) {
  assert.equal(new Set(node.bots.map(bot => bot.workspaceDir)).size, node.bots.length, `Node ${demoNode} Bot workspace paths must differ`);
  const readyBots = node.bots.filter(bot => bot.runtimeReady);
  assert.equal(new Set(readyBots.map(bot => bot.workspaceRealPath)).size, readyBots.length, `Node ${demoNode} Bot workspaces must resolve to different actual directories`);
  if (options[`--expect-${demoNode}`] !== undefined) {
    assert.equal(node.bots.length, Number(options[`--expect-${demoNode}`]), `Node ${demoNode} Bot count`);
    assert.ok(node.bots.every(bot => bot.runtimeReady), `Run one goal for every Bot on node ${demoNode} before validating Host identities`);
    for (const bot of node.bots) {
      assert.equal(bot.artifacts.environment, `node-${demoNode}`);
      assert.equal(bot.artifacts.platform, "Linux");
      assert.ok(bot.artifacts.runLines > 0);
    }
  }
}
let comparison;
if (options["--baseline"]) {
  const baseline = JSON.parse(await readFile(options["--baseline"], "utf8"));
  assert.deepEqual(nodes.b, baseline.nodes.b, "Node B identities, tasks, or workspace artifacts changed since the baseline");
  assert.equal(nodes.a.nodeId, baseline.nodes.a.nodeId, "Node A identity must remain unchanged");
  for (const oldBot of baseline.nodes.a.bots) {
    assert.deepEqual(nodes.a.bots.find(bot => bot.id === oldBot.id), oldBot, "An existing Node A Bot changed while adding another Bot");
  }
  comparison = { nodeBUnchanged: true, existingNodeABotsUnchanged: true, addedNodeABotIds: nodes.a.bots.filter(bot => !baseline.nodes.a.bots.some(old => old.id === bot.id)).map(bot => bot.id) };
}
console.log(JSON.stringify({
  readOnly: true, inspectedAt: new Date().toISOString(),
  assertions: { distinctNodeIds: true, distinctBotIds: true, distinctInitializedHostAgentIds: true, distinctWorkspacePathsWithinEachNode: true, distinctInitializedRealWorkspacePathsWithinEachNode: true },
  ...(comparison ? { comparison } : {}),
  fingerprints: { a: hash(JSON.stringify(nodes.a)), b: hash(JSON.stringify(nodes.b)) },
  nodes,
}, null, 2));
