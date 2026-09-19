// Local Docker acceptance fixture only. This is not a general-purpose AI model.
// Each container keeps its own node identity, owner, Bots, and workspaces.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, createServer as createTcpServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const dataDir = "/var/lib/beebot-node";
const controllerEntry = "/app/.build/node/node/main.mjs";
const controllerPort = 7331;
const relayPort = 7332;
const modelPort = 7333;
const dummyApiKey = "beebot-local-demo-only-not-a-real-key";
const sockets = new Set();
let modelServer;
let relayServer;
let controller;
let controllerDone;
let stopping = false;
let stopReason;
let resolveStop;
const stopRequested = new Promise(resolve => { resolveStop = resolve; });

function requestStop(reason) {
  if (stopping) return;
  stopping = true;
  stopReason = reason;
  resolveStop(reason);
}
process.on("SIGTERM", () => requestStop({ kind: "signal" }));
process.on("SIGINT", () => requestStop({ kind: "signal" }));
function checkStopping() { if (stopping) throw new Error("Demo startup was interrupted"); }

async function loadOrInitialize(node, publicPort) {
  const configPath = path.join(dataDir, "node.json");
  const expected = {
    name: `BeeBot Docker ${node.toUpperCase()}`,
    publicUrl: `http://127.0.0.1:${publicPort}`,
    model: { baseUrl: `http://127.0.0.1:${modelPort}/v1`, modelId: `beebot-local-demo-${node}`, apiKeyEnv: "CUSTOM_API_KEY" },
  };
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let text;
  try { text = await readFile(configPath, "utf8"); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const config = { version: 1, nodeId: randomUUID(), ...expected, bindHost: "127.0.0.1", port: controllerPort, maxConcurrentRuns: 2 };
    const temporary = `${configPath}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(config, null, 2)}\n`); await file.sync(); }
    finally { await file.close(); }
    try {
      // Linking publishes the complete configuration without replacing an
      // existing persistent identity, including a concurrent initialization.
      try { await link(temporary, configPath); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      const directory = await open(dataDir, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temporary, { force: true }); }
    text = await readFile(configPath, "utf8");
  }
  const config = JSON.parse(text);
  if (config.version !== 1 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.nodeId ?? "") ||
      config.name !== expected.name || config.publicUrl !== expected.publicUrl ||
      config.bindHost !== "127.0.0.1" || config.port !== controllerPort || config.tls !== undefined || config.tlsTermination !== undefined ||
      config.model?.baseUrl !== expected.model.baseUrl || config.model?.modelId !== expected.model.modelId || config.model?.apiKeyEnv !== "CUSTOM_API_KEY") {
    throw new Error("The existing node.json does not match this demo node, public URL, or local fixture. It was left unchanged; check the assigned persistent volume.");
  }
  return config;
}

function messageText(message) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("\n");
}

function nextAction(input, node) {
  if (!Array.isArray(input.messages)) throw new Error("The fixture requires chat messages");
  const messages = input.messages;
  // State comes from this conversation's tool boundary, never a global request
  // counter. A different Bot or a second goal therefore starts its own sequence.
  let boundary = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role !== "user") continue;
    const text = messageText(messages[index]).trim();
    if (text.startsWith("<system_reminder>")) continue;
    boundary = index;
    break;
  }
  if (boundary < 0) throw new Error("The fixture requires a user turn");
  // Autonomous Host timeline events are not authorized demo tasks.
  if (messageText(messages[boundary]).includes("[SAND_HIDDEN_PROMPT]")) return undefined;
  const turn = messages.slice(boundary + 1);
  const calls = turn.flatMap(message => message?.role === "assistant" && Array.isArray(message.tool_calls) ? message.tool_calls : []);
  const sent = calls.find(call => call?.function?.name === "SendMessage");
  if (sent) return undefined;
  const shell = calls.find(call => call?.function?.name === "Shell");
  if (shell) {
    if (!turn.some(message => message?.role === "tool" && message.tool_call_id === shell.id)) throw new Error("The fixture is waiting for the Shell result");
    return { name: "SendMessage", arguments: JSON.stringify({ type: "text", content: `节点 ${node.toUpperCase()} 的固定验收流程已执行真实 Shell：写入 environment.txt（node-${node}）和 platform.txt，并向 runs.txt 追加一条记录。\n\n当前使用本地确定性测试模型，仅验证连接、认证、工具执行和持久化；不会理解或执行任意任务内容。` }) };
  }
  return { name: "Shell", arguments: JSON.stringify({
    command: `printf '%s\\n' 'node-${node}' > environment.txt && uname -s > platform.txt && printf '%s\\n' 'node-${node}' >> runs.txt`,
    working_directory: "/workspace", block_until_ms: 1000,
  }) };
}

function json(response, status, message) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ error: { message } }));
}

function createModel(config, node) {
  return createHttpServer((request, response) => {
    void (async () => {
      if (stopping) { json(response, 503, "Demo is stopping"); return; }
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") { json(response, 404, "Only the fixed demo chat fixture is available"); return; }
      if (request.headers.authorization !== `Bearer ${dummyApiKey}`) { json(response, 401, "Invalid local fixture credential"); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) throw new Error("Demo request is too large");
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (input.model !== config.model.modelId) throw new Error("Unexpected demo model");
      const action = nextAction(input, node);
      if (action && !input.tools?.some(tool => tool?.function?.name === action.name)) throw new Error(`Required demo tool is unavailable: ${action.name}`);
      const id = randomUUID();
      const envelope = { id: `demo-${id}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: config.model.modelId };
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      response.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: { role: "assistant", ...(action ? { tool_calls: [{ index: 0, id: `call-${id}`, type: "function", function: action }] } : { content: "" }) }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: action ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
      response.end("data: [DONE]\n\n");
    })().catch(error => {
      if (!response.headersSent && !response.destroyed) json(response, 400, error instanceof Error ? error.message : "Invalid demo request");
      else response.destroy();
    });
  });
}

function createRelay() {
  return createTcpServer(client => {
    const upstream = createConnection({ host: "127.0.0.1", port: controllerPort });
    sockets.add(client); sockets.add(upstream);
    const cleanup = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
    client.on("error", cleanup); upstream.on("error", cleanup);
    client.on("close", cleanup); upstream.on("close", cleanup);
    client.pipe(upstream); upstream.pipe(client);
  });
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
  server.on("error", error => requestStop({ kind: "failure", error }));
}
async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(() => resolve()));
}

async function cleanup() {
  const closingRelay = closeServer(relayServer);
  for (const socket of sockets) socket.destroy();
  await closingRelay;
  if (controller?.pid && controller.exitCode === null && controller.signalCode === null) {
    controller.kill("SIGTERM");
    let timer;
    const forced = await Promise.race([
      controllerDone.then(() => false),
      new Promise(resolve => { timer = setTimeout(() => resolve(true), 20_000); }),
    ]);
    clearTimeout(timer);
    if (forced) {
      console.error("[local-demo] Controller exceeded its shutdown deadline; stopping it and allowing supervised Hosts to reap their tools.");
      controller.kill("SIGKILL");
      await controllerDone;
      await delay(7_500);
      process.exitCode = 1;
    }
  }
  await closeServer(modelServer);
}

try {
  const node = process.env.DEMO_NODE;
  if (node !== "a" && node !== "b") throw new Error("Set DEMO_NODE to a or b");
  const expectedPort = node === "a" ? 17431 : 17432;
  const publicPort = Number(process.env.DEMO_PUBLIC_PORT ?? expectedPort);
  if (publicPort !== expectedPort) throw new Error(`DEMO_NODE=${node} requires DEMO_PUBLIC_PORT=${expectedPort}`);
  const config = await loadOrInitialize(node, publicPort);
  checkStopping();
  modelServer = createModel(config, node);
  await listen(modelServer, modelPort, "127.0.0.1");
  checkStopping();
  const environment = { CUSTOM_API_KEY: dummyApiKey };
  for (const name of ["PATH", "HOME", "SHELL", "LANG", "LC_ALL", "TZ", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  controller = spawn(process.execPath, [controllerEntry, "start", "--data-dir", dataDir], { env: environment, stdio: "inherit" });
  controllerDone = new Promise(resolve => {
    controller.once("exit", (code, signal) => resolve({ kind: "exit", code, signal }));
    controller.once("error", error => resolve({ kind: "failure", error }));
  });
  relayServer = createRelay();
  await listen(relayServer, relayPort, "0.0.0.0");
  checkStopping();
  console.log(`[local-demo] ${config.name} (${config.nodeId}) at ${config.publicUrl}`);
  console.log("[local-demo] Fixed acceptance fixture only: every goal writes environment.txt / platform.txt and appends one runs.txt line. Arbitrary prompts are not interpreted. Publish this relay only on the Docker host's 127.0.0.1.");
  const reason = await Promise.race([controllerDone, stopRequested]);
  if (reason.kind === "failure") throw reason.error;
  if (reason.kind === "exit") process.exitCode = reason.code ?? 1;
} catch (error) {
  if (!stopping || stopReason?.kind === "failure") {
    console.error("[local-demo]", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} finally {
  stopping = true;
  try { await cleanup(); }
  catch (error) { console.error("[local-demo] Cleanup failed:", error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
