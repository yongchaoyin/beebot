import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { api, taskFixture } from "./helpers/node-task-security-fixture.mjs";

// Explicit opt-in: a real Host and Shell subprocess, not a mocked AbortSignal.
// The model response is controlled; no paid provider credentials are involved.
test("device quarantine terminates real Shell descendants, persists across restart and never replays stopped work", {
  skip: process.env.BEEBOT_RUNTIME_INTEGRATION !== "1", timeout: 90_000,
}, async t => {
  let resumed = false;
  const f = await taskFixture(t, { runtime: dataDir => new api.HostRuntime({ dataDir,
    hostEntry: path.resolve(import.meta.dirname, "../.build/node/dist/host/host-main.cjs"),
    env: { SAND_AGENT_MOCK_RESPONSE: JSON.stringify(resumed ? { sendMessage: "New authorized work" } : { toolCalls: [
      { toolName: "Shell", args: { command: "echo $$ > safety-shell.pid; trap '' TERM; sleep 45 & wait", working_directory: "/workspace", block_until_ms: 60000 } },
      { toolName: "SendMessage", args: { type: "text", content: "Must not become successful" } },
    ] }) },
  }) });
  console.info("task safety integration: Node started");
  const admin = await f.first();
  const bot = (await (await admin.request("/v1/bots", {name:"Safety integration Bot"})).json()).bot;
  console.info("task safety integration: first device authorized and Bot created");
  const operator = await f.second(admin, {role:"operator",botIds:[bot.id]});
  const submitted = await operator.request("/v1/goals", {botId:bot.id,prompt:"Start the test shell"});
  assert.equal(submitted.status,202,await submitted.clone().text());const first=await submitted.json();
  const queued=await (await operator.request("/v1/goals",{botId:bot.id,prompt:"Do not dispatch this queued work"})).json();
  const marker=path.join(f.dataDir,"runtime-bots",createHash("sha256").update(bot.id).digest("hex"),"host/box-workspace/safety-shell.pid");
  let pid;
  for(let i=0;i<200;i++) {try{pid=Number((await readFile(marker,"utf8")).trim());break;}catch(e){if(e.code!=="ENOENT")throw e;}await delay(100);}
  console.info("task safety integration: Shell probe", {pid, goal:f.server.store.goal(first.goalId).status, error:f.server.store.goal(first.goalId).error});
  assert.ok(pid>0,"a real Shell must start before exercising security cancellation");
  const devices=await (await admin.request("/v1/security/sessions")).json();const target=devices.devices.find(d=>d.jkt===operator.device.jkt);
  const response=await admin.request(`/v1/security/devices/${target.jkt}/block-and-freeze`,{expectedVersion:target.version});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(f.server.store.goal(queued.goalId).status,"cancelled");
  for(let i=0;i<200&&f.server.store.goal(first.goalId).status!=="uncertain";i++)await delay(100);
  assert.equal(f.server.store.goal(first.goalId).status,"uncertain");
  assert.throws(()=>process.kill(pid,0),e=>e.code==="ESRCH","stopping acknowledgement requires the Shell process to be gone");
  assert.equal((await operator.request("/v1/snapshot")).status,401);
  const runId=f.server.store.task(f.server.store.goal(first.goalId).taskId).currentRunId;
  console.info("task safety integration: Shell stop confirmed");
  resumed=true;await f.restart();
  assert.equal(f.server.store.goal(first.goalId).status,"uncertain");assert.equal(f.server.store.goal(queued.goalId).status,"cancelled");
  assert.ok(f.server.store.taskSecurity.active(bot.ownerId,"device",target.jkt));assert.equal((await operator.request("/v1/snapshot")).status,401);
  const interrupted=f.server.store.goal(first.goalId);
  const inspected=await admin.request(`/v1/goals/${first.goalId}/reconcile`,{expectedVersion:interrupted.version,note:"Verified the Shell process stopped and inspected its workspace and external effects."});
  assert.equal(inspected.status,200,await inspected.clone().text());
  const fresh=await (await admin.request("/v1/goals",{botId:bot.id,prompt:"Start only this newly authorized task"})).json();
  for(let i=0;i<200&&f.server.store.goal(fresh.goalId).status!=="review";i++)await delay(100);
  assert.equal(f.server.store.goal(fresh.goalId).result,"New authorized work");
  assert.equal(f.server.store.task(f.server.store.goal(first.goalId).taskId).currentRunId,runId);assert.equal(f.server.store.goal(queued.goalId).status,"cancelled");
  assert.equal(await readFile(marker,"utf8"),`${pid}\n`,"the original Shell did not execute again");
});
