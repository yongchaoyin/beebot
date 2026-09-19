import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(path.join(os.tmpdir(), "beebot-runtime-module-"));
await build({ entryPoints: [path.join(repoRoot, "source/node/runtime.ts")], outfile: path.join(output, "runtime.mjs"), bundle: true, format: "esm", platform: "node", target: "node26" });
await build({ entryPoints: [path.join(repoRoot, "source/host/runner/conversation-outline.ts")], outfile: path.join(output, "outline.mjs"), bundle: true, format: "esm", platform: "node", target: "node26" });
const { HostRuntime, runtimeEnvironment } = await import(pathToFileURL(path.join(output, "runtime.mjs")).href);
const { getOutlineToolCallStatus } = await import(pathToFileURL(path.join(output, "outline.mjs")).href);
test.after(() => rm(output, { recursive: true, force: true }));
const integration = { skip: process.env.BEEBOT_RUNTIME_INTEGRATION !== "1", timeout: 90_000 };
const hash = value => createHash("sha256").update(value).digest("hex");
const hostEntry = path.join(repoRoot, ".build/node/dist/host/host-main.cjs");

test("structured tool failures remain failures for live and persisted outlines", () => {
  for (const tool of ["shellToolCall", "taskToolCall", "readToolCall"]) {
    for (const outcome of ["error", "failure", "timeout", "rejected", "spawnError", "permissionDenied"]) {
      const call = { tool: { case: tool, value: { result: { result: { case: outcome } } } } };
      assert.equal(getOutlineToolCallStatus("toolCallCompleted", call), "failed");
      assert.equal(getOutlineToolCallStatus("toolCallStarted", call), "pending");
    }
    assert.equal(getOutlineToolCallStatus("toolCallCompleted", { tool: { case: tool, value: { result: { result: { case: "success" } } } } }), "done");
  }
});

test("Bot subprocess environment excludes control plane and inherited provider credentials", () => {
  const actual = runtimeEnvironment({ BEEBOT_ADMIN_TOKEN: "admin", BEEBOT_PAIR_CODE: "pair", SAND_GATEWAY_TOKEN: "old", CUSTOM_API_KEY: "explicit", NODE_OPTIONS: "--require evil", SAND_AGENT_MOCK_RESPONSE: "test" }, { PATH: "/bin", HOME: "/home/test", CUSTOM_API_KEY: "inherited", OTHER_SECRET: "secret" });
  assert.deepEqual(actual, { PATH: "/bin", HOME: "/home/test", CUSTOM_API_KEY: "explicit", SAND_AGENT_MOCK_RESPONSE: "test" });
});

test("pre-cancelled execution never starts a runtime", async () => {
  const runtime = new HostRuntime({ dataDir: output, hostEntry: "/does-not-exist" });
  await assert.rejects(runtime.execute({ runId: "cancelled", bot: { id: "one", name: "One", description: "" }, prompt: "hello" }, AbortSignal.abort()), error => error.code === "cancelled");
  await runtime.close();
});

test("unconfigured runtime never falls back to an owner's desktop credentials", async () => {
  const runtime = new HostRuntime({ dataDir: output, hostEntry: "/does-not-exist" });
  await assert.rejects(runtime.execute({ runId: "unconfigured", bot: { id: "unconfigured", name: "One", description: "" }, prompt: "hello" }, new AbortController().signal), /Configure an explicit server model/);
  await runtime.close();
});

test("real Host preserves Bot identity, returns real SendMessage, deduplicates and survives service restart", integration, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "beebot-runtime-real-"));
  const options = { dataDir, hostEntry: path.join(repoRoot, ".build/node/dist/host/host-main.cjs"), env: { SAND_AGENT_MOCK_RESPONSE: JSON.stringify({ sendMessage: "Persistent Bot reply" }) } };
  let runtime = new HostRuntime(options);
  const bot = { id: "durable-bot", name: "Durable Bot", description: "Remember your work", avatarColor: "cyan", avatarShape: "cloud" };
  const input = { runId: "first-turn", bot, prompt: "Hello, remember the number 7" };
  try {
    const first = await runtime.execute(input, new AbortController().signal);
    assert.equal(first.text, "Persistent Bot reply");
    assert.ok(first.transcript.some(entry => entry.kind === "send-message"));
    assert.deepEqual(await runtime.execute(input, new AbortController().signal), first);
    await assert.rejects(runtime.execute({ ...input, prompt: "different" }, new AbortController().signal), /different input/);
    const mappingPath = path.join(dataDir, "runtime-bots", hash(bot.id), "agent.json");
    const originalMapping = await readFile(mappingPath, "utf8");
    const profilePath = path.join(path.dirname(mappingPath), "host", "agents", JSON.parse(originalMapping).agentId, "profile.json");
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    assert.equal(profile.avatarColor, "cyan"); assert.equal(profile.avatarShape, "cloud");
    await runtime.close();
    runtime = new HostRuntime(options);
    assert.deepEqual(await runtime.execute(input, new AbortController().signal), first);
    const second = await runtime.execute({ ...input, runId: "second-turn", prompt: "Continue" }, new AbortController().signal);
    assert.equal(second.text, "Persistent Bot reply");
    assert.equal(await readFile(mappingPath, "utf8"), originalMapping);
    assert.equal(JSON.parse(await readFile(profilePath, "utf8")).avatarColor, "cyan");
    assert.equal(JSON.parse(await readFile(profilePath, "utf8")).avatarShape, "cloud");
    const other = await runtime.execute({ runId: "other-turn", bot: { ...bot, id: "separate-bot" }, prompt: "Hello" }, new AbortController().signal);
    assert.equal(other.text, "Persistent Bot reply");
    assert.notEqual(JSON.parse(await readFile(path.join(dataDir, "runtime-bots", hash("separate-bot"), "agent.json"), "utf8")).agentId, JSON.parse(originalMapping).agentId);
  } finally {
    await runtime.close();
    if (process.env.BEEBOT_KEEP_RUNTIME_TEST_DATA !== "1") await rm(dataDir, { recursive: true, force: true });
    else console.log(`Runtime test data: ${dataDir}`);
  }
});

test("real runtime executes shell tools and persists the Bot workspace", integration, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "beebot-runtime-tools-"));
  const bot = { id: "tool-bot", name: "Tool Bot", description: "Use your workspace" };
  const options = { dataDir, hostEntry, env: { SAND_AGENT_MOCK_RESPONSE: JSON.stringify({ toolCalls: [
    { toolName: "Shell", args: { command: "printf 'durable-work\\n' >> integration-marker.txt", working_directory: "/workspace", block_until_ms: 1000 } },
    { toolName: "SendMessage", args: { type: "text", content: "Workspace saved" } },
  ] }) } };
  let runtime = new HostRuntime(options);
  try {
    const result = await runtime.execute({ runId: "write", bot, prompt: "Write the marker in your workspace" }, new AbortController().signal);
    assert.equal(result.text, "Workspace saved");
    assert.equal(result.transcript.filter(entry => entry.kind === "send-message").length, 1);
    const workspace = path.join(dataDir, "runtime-bots", hash(bot.id), "host/box-workspace");
    assert.equal(await readFile(path.join(workspace, "integration-marker.txt"), "utf8"), "durable-work\n", "profile setup must not execute an untracked Shell turn");
    await runtime.close();
    runtime = new HostRuntime(options);
    const next = await runtime.execute({ runId: "write-again", bot: { ...bot, name: "Renamed Tool Bot" }, prompt: "Append another marker" }, new AbortController().signal);
    assert.equal(next.text, "Workspace saved");
    assert.equal(await readFile(path.join(workspace, "integration-marker.txt"), "utf8"), "durable-work\ndurable-work\n", "profile changes on restart must not execute an additional Shell turn");
  } finally {
    await runtime.close();
    if (process.env.BEEBOT_KEEP_RUNTIME_TEST_DATA !== "1") await rm(dataDir, { recursive: true, force: true });
    else console.log(`Runtime test data: ${dataDir}`);
  }
});

test("failed tools and user questions never become successful executions", integration, async () => {
  for (const [name, toolCalls, expectedCode] of [
    ["failed-tool", [{ toolName: "Shell", args: { command: "exit 7", working_directory: "/workspace", block_until_ms: 1000 } }, { toolName: "SendMessage", args: { type: "text", content: "Misleading success" } }], "failed"],
    ["question", [{ toolName: "SendMessage", args: { type: "widget", widget: { prompt: "Continue?", options: [{ label: "Continue", value: "yes" }] } } }], "needs_input"],
  ]) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), `beebot-runtime-${name}-`));
    const runtime = new HostRuntime({ dataDir, hostEntry, env: { SAND_AGENT_MOCK_RESPONSE: JSON.stringify({ toolCalls }) } });
    try {
      await assert.rejects(runtime.execute({ runId: name, bot: { id: name, name, description: "" }, prompt: name }, new AbortController().signal), error => error.code === expectedCode);
    } finally {
      await runtime.close();
      if (process.env.BEEBOT_KEEP_RUNTIME_TEST_DATA !== "1") await rm(dataDir, { recursive: true, force: true });
      else console.log(`Runtime test data: ${dataDir}`);
    }
  }
});

test("cancelling an active run kills shell descendants and fences the Bot against blind restart", integration, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "beebot-runtime-cancel-"));
  const bot = { id: "cancel-bot", name: "Cancel Bot", description: "" };
  const controller = new AbortController();
  const runtime = new HostRuntime({ dataDir, hostEntry, env: { SAND_AGENT_MOCK_RESPONSE: JSON.stringify({ toolCalls: [
    { toolName: "Shell", args: { command: "echo $$ > cancel-shell.pid; trap '' TERM; sleep 45 & wait", working_directory: "/workspace", block_until_ms: 60000 } },
    { toolName: "SendMessage", args: { type: "text", content: "Should not complete" } },
  ] }) } });
  const marker = path.join(dataDir, "runtime-bots", hash(bot.id), "host/box-workspace/cancel-shell.pid");
  const execution = runtime.execute({ runId: "cancel", bot, prompt: "Run the long test command" }, controller.signal);
  const rejected = assert.rejects(execution, error => error.code === "cancelled");
  void rejected.catch(() => {});
  try {
    let pid;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { pid = Number((await readFile(marker, "utf8")).trim()); break; } catch (error) { if (error.code !== "ENOENT") throw error; }
      await delay(100);
    }
    assert.ok(pid > 0, "real shell command must have started before cancellation");
    controller.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH");
    await assert.rejects(runtime.execute({ runId: "after-cancel", bot, prompt: "Continue" }, new AbortController().signal), error => error.code === "uncertain");
    const mappingPath = path.join(dataDir, "runtime-bots", hash(bot.id), "agent.json");
    const mapping = await readFile(mappingPath, "utf8");
    await assert.rejects(runtime.reconcile(bot, "wrong-run"), /does not match/);
    await runtime.reconcile(bot, "cancel");
    await runtime.reconcile(bot, "cancel");
    await assert.rejects(runtime.execute({ runId: "cancel", bot, prompt: "Run the long test command" }, new AbortController().signal), error => error.code === "cancelled");
    const recovered = new HostRuntime({ dataDir, hostEntry, env: { SAND_AGENT_MOCK_RESPONSE: JSON.stringify({ sendMessage: "Resumed after owner review" }) } });
    try {
      const result = await recovered.execute({ runId: "reviewed-new-run", bot, prompt: "Continue after I verified the effects" }, new AbortController().signal);
      assert.equal(result.text, "Resumed after owner review");
      assert.equal(await readFile(mappingPath, "utf8"), mapping);
    } finally { await recovered.close(); }
  } finally {
    controller.abort();
    await runtime.close();
    await rejected.catch(() => {});
    if (process.env.BEEBOT_KEEP_RUNTIME_TEST_DATA !== "1") await rm(dataDir, { recursive: true, force: true });
    else console.log(`Runtime test data: ${dataDir}`);
  }
});

test("receipt write failure during cancellation still stops Shell descendants and keeps the fence", integration, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "beebot-runtime-cancel-disk-"));
  const bot = { id: "cancel-disk-bot", name: "Cancel Disk Bot", description: "" };
  const botRoot = path.join(dataDir, "runtime-bots", hash(bot.id));
  const runs = path.join(botRoot, "runs");
  const parkedRuns = path.join(botRoot, "runs-write-failure-fixture");
  const controller = new AbortController();
  const runtime = new HostRuntime({ dataDir, hostEntry, env: { SAND_AGENT_MOCK_RESPONSE: JSON.stringify({ toolCalls: [
    { toolName: "Shell", args: { command: "echo $$ > disk-shell.pid; trap '' TERM; sleep 45 & wait", working_directory: "/workspace", block_until_ms: 60000 } },
  ] }) } });
  const execution = runtime.execute({ runId: "cancel-disk", bot, prompt: "Start the isolated disk-failure test" }, controller.signal);
  const outcome = execution.catch(error => error);
  let parked = false;
  try {
    let pid;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { pid = Number((await readFile(path.join(botRoot, "host/box-workspace/disk-shell.pid"), "utf8")).trim()); break; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await delay(100);
    }
    assert.ok(pid > 0, "real shell must start before breaking receipt storage");
    // Make writes fail even if this integration suite runs as root in CI.
    // Preserve all original receipts and restore their directory before cleanup.
    await rename(runs, parkedRuns); parked = true;
    await writeFile(runs, "receipt storage temporarily unavailable");
    controller.abort();
    const failure = await outcome;
    assert.equal(failure.code, "ENOTDIR");
    assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH");
    assert.equal(JSON.parse(await readFile(path.join(botRoot, "active-run.json"), "utf8")).runId, "cancel-disk");
    await rm(runs); await rename(parkedRuns, runs); parked = false;
    await assert.rejects(runtime.execute({ runId: "after-disk-failure", bot, prompt: "Continue" }, new AbortController().signal), error => error.code === "uncertain");
    await assert.rejects(runtime.execute({ runId: "cancel-disk", bot, prompt: "Start the isolated disk-failure test" }, new AbortController().signal), error => error.code === "uncertain");
  } finally {
    controller.abort();
    if (parked) { await rm(runs, { force: true }); await rename(parkedRuns, runs); }
    await outcome;
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("repeated daemon termination signals still reap detached Shell groups", integration, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "beebot-runtime-double-stop-"));
  const bot = { id: "double-stop-bot", name: "Double Stop Bot", description: "" };
  const workspace = path.join(dataDir, "runtime-bots", hash(bot.id), "host/box-workspace");
  const controller = new AbortController();
  const runtime = new HostRuntime({ dataDir, hostEntry, env: { SAND_AGENT_MOCK_RESPONSE: JSON.stringify({ toolCalls: [
    { toolName: "Shell", args: { command: "echo $PPID > daemon.pid; echo $$ > shell.pid; trap '' TERM; sleep 45 & wait", working_directory: "/workspace", block_until_ms: 60000 } },
  ] }) } });
  const outcome = runtime.execute({ runId: "double-stop", bot, prompt: "Start the isolated termination test" }, controller.signal).catch(error => error);
  let shellPid;
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      try { shellPid = Number((await readFile(path.join(workspace, "shell.pid"), "utf8")).trim()); break; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await delay(100);
    }
    assert.ok(shellPid > 0, "shell must run before signalling its daemon");
    const daemonPid = Number((await readFile(path.join(workspace, "daemon.pid"), "utf8")).trim());
    assert.ok(daemonPid > 0);
    process.kill(daemonPid, "SIGTERM");
    await delay(25);
    process.kill(daemonPid, "SIGTERM");
    controller.abort();
    assert.ok(await outcome instanceof Error);
    assert.throws(() => process.kill(shellPid, 0), error => error.code === "ESRCH");
    await assert.rejects(runtime.execute({ runId: "after-double-stop", bot, prompt: "Continue" }, new AbortController().signal), error => error.code === "uncertain");
  } finally {
    controller.abort();
    await outcome;
    await runtime.close();
    if (shellPid) { try { process.kill(-shellPid, "SIGKILL"); } catch {} }
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("custom HTTP model configuration uses real tools and waits for background work", integration, async () => {
  const requests = [];
  const model = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ url: request.url, authorization: request.headers.authorization, input });
    const index = requests.length - 1;
    const action = [
      { name: "Shell", arguments: JSON.stringify({ command: "sleep 2; printf 'http-tool' > http-marker.txt", working_directory: "/workspace", block_until_ms: 0 }) },
      { name: "SendMessage", arguments: JSON.stringify({ type: "text", content: "HTTP provider delivered" }) },
    ][index];
    response.writeHead(200, { "content-type": "text/event-stream" });
    const envelope = { id: `fixture-${index}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "local-fixture" };
    response.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: { role: "assistant", ...(action ? { tool_calls: [{ index: 0, id: `call-${index}`, type: "function", function: action }] } : { content: "" }) }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: action ? "tool_calls" : "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve, reject) => { model.once("error", reject); model.listen(0, "127.0.0.1", resolve); });
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "beebot-runtime-http-"));
  const runtime = new HostRuntime({ dataDir, hostEntry, settings: { inferenceProvider: "custom", inferenceHttp: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, modelId: "local-fixture" }, localAccountActive: true }, env: { CUSTOM_API_KEY: "local-test-key" } });
  const bot = { id: "http-bot", name: "HTTP Bot", description: "" };
  try {
    const result = await runtime.execute({ runId: "http", bot, prompt: "Use a shell and deliver the result" }, AbortSignal.timeout(45_000));
    assert.equal(result.text, "HTTP provider delivered");
    assert.ok(requests.length >= 3);
    assert.ok(requests.every(request => request.url === "/v1/chat/completions" && request.authorization === "Bearer local-test-key" && request.input.model === "local-fixture"));
    assert.ok(requests[0].input.tools.some(tool => tool.function.name === "Shell"));
    assert.equal(await readFile(path.join(dataDir, "runtime-bots", hash(bot.id), "host/box-workspace/http-marker.txt"), "utf8"), "http-tool");
  } finally {
    await runtime.close();
    model.closeAllConnections();
    await new Promise(resolve => model.close(resolve));
    if (process.env.BEEBOT_KEEP_RUNTIME_TEST_DATA !== "1") await rm(dataDir, { recursive: true, force: true });
    else console.log(`Runtime test data: ${dataDir}`);
  }
});

test("controller crash disconnects and stops owned Bot processes without replaying the run", integration, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "beebot-runtime-orphan-"));
  const bot = { id: "orphan-bot", name: "Orphan Bot", description: "" };
  const env = { SAND_AGENT_MOCK_RESPONSE: JSON.stringify({ toolCalls: [{ toolName: "Shell", args: { command: "echo $$ > orphan-shell.pid; trap '' TERM; sleep 45 & wait", working_directory: "/workspace", block_until_ms: 60000 } }] }) };
  const fixturePath = path.join(dataDir, "controller.mjs");
  await writeFile(fixturePath, `import {HostRuntime} from ${JSON.stringify(pathToFileURL(path.join(output, "runtime.mjs")).href)};\nconst runtime=new HostRuntime(${JSON.stringify({ dataDir, hostEntry, env })});\nawait runtime.execute(${JSON.stringify({ runId: "orphan-run", bot, prompt: "Start the long test command" })},new AbortController().signal);\nawait runtime.close();\n`);
  const controller = spawn(process.execPath, [fixturePath], { stdio: "ignore" });
  const exited = new Promise(resolve => controller.once("exit", resolve));
  const marker = path.join(dataDir, "runtime-bots", hash(bot.id), "host/box-workspace/orphan-shell.pid");
  let shellPid;
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      try { shellPid = Number((await readFile(marker, "utf8")).trim()); break; } catch (error) { if (error.code !== "ENOENT") throw error; }
      await delay(100);
    }
    assert.ok(shellPid > 0, "shell must run before killing controller");
    controller.kill("SIGKILL");
    await exited;
    let alive = true;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { process.kill(shellPid, 0); } catch (error) { if (error.code === "ESRCH") { alive = false; break; } throw error; }
      await delay(100);
    }
    if (alive && process.platform !== "win32") console.error(execFileSync("ps", ["-o", "pid,ppid,pgid,state,comm", "-p", String(shellPid)], { encoding: "utf8" }));
    assert.equal(alive, false, "orphan shell must be reaped after controller IPC disconnect");
    const replacement = new HostRuntime({ dataDir, hostEntry, env });
    try {
      await assert.rejects(replacement.execute({ runId: "orphan-run", bot, prompt: "Start the long test command" }, new AbortController().signal), error => error.code === "uncertain");
      await assert.rejects(replacement.execute({ runId: "replacement", bot, prompt: "Start a replacement" }, new AbortController().signal), error => error.code === "uncertain");
    } finally { await replacement.close(); }
  } finally {
    controller.kill("SIGKILL");
    await exited;
    if (shellPid) { try { process.kill(-shellPid, "SIGKILL"); } catch {} }
    if (process.env.BEEBOT_KEEP_RUNTIME_TEST_DATA !== "1") await rm(dataDir, { recursive: true, force: true });
    else console.log(`Runtime test data: ${dataDir}`);
  }
});
