import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = await mkdtemp(path.join(os.tmpdir(), "beebot-owned-signal-"));
await build({entryPoints:[path.resolve(import.meta.dirname,"../source/node/owned-process-signal.ts")],outfile:path.join(output,"signal.mjs"),bundle:true,platform:"node",format:"esm",target:"node26"});
const { signalOwnedRuntime } = await import(pathToFileURL(path.join(output,"signal.mjs")));
test.after(()=>rm(output,{recursive:true,force:true}));
const pid=process.pid+100001;
const error=code=>Object.assign(new Error(code),{code});
function harness(platform,handle){
  const calls=[],waits=[];
  return {calls,waits,ports:{platform,kill(target,signal){calls.push([target,signal]);return handle(target,signal,calls.length);},async wait(ms){waits.push(ms);}}};
}

test("owned runtime targets POSIX group and Windows child without extra probes",async()=>{
  for(const platform of ["darwin","linux","win32"]){
    const h=harness(platform,()=>true);await signalOwnedRuntime(pid,"SIGTERM",h.ports);
    assert.deepEqual(h.calls,[[platform==="win32"?pid:-pid,"SIGTERM"]]);assert.deepEqual(h.waits,[]);
  }
});
test("explicitly absent owned group is complete without retries",async()=>{
  const h=harness("darwin",()=>{throw error("ESRCH")});await signalOwnedRuntime(pid,"SIGKILL",h.ports);
  assert.equal(h.calls.length,1);assert.deepEqual(h.waits,[]);
});
test("macOS denied signal needs explicit group disappearance confirmation",async()=>{
  const h=harness("darwin",(_target,signal)=>{throw error(signal===0?"ESRCH":"EPERM")});
  await signalOwnedRuntime(pid,"SIGKILL",h.ports);
  assert.deepEqual(h.calls,[[-pid,"SIGKILL"],[-pid,0]]);assert.deepEqual(h.waits,[]);
});
test("short teardown race is only observed, never signalled again",async()=>{
  const h=harness("darwin",(_target,signal,n)=>{if(signal!==0||n===2)throw error("EPERM");if(n===4)throw error("ESRCH");return true;});
  await signalOwnedRuntime(pid,"SIGTERM",h.ports);
  assert.equal(h.calls.filter(([,signal])=>signal!==0).length,1);assert.deepEqual(h.waits,[50,50]);assert.equal(h.calls.length,4);
});
test("persistent macOS denial remains an error and cannot report cleanup success",async()=>{
  const denied=error("EPERM"),h=harness("darwin",()=>{throw denied});
  await assert.rejects(signalOwnedRuntime(pid,"SIGKILL",h.ports),e=>e===denied);
  assert.equal(h.calls.length,21);assert.equal(h.waits.length,19);assert.equal(h.waits.reduce((a,b)=>a+b,0),950);
});
test("successful signal-zero probes mean the group is still alive, not gone",async()=>{
  const denied=error("EPERM"),h=harness("darwin",(_target,signal)=>{if(signal!==0)throw denied;return true;});
  await assert.rejects(signalOwnedRuntime(pid,"SIGKILL",h.ports),e=>e===denied);
  assert.equal(h.calls.length,21);assert.equal(h.calls.filter(([,signal])=>signal!==0).length,1);
});
test("other platforms and unknown probe errors preserve the failure",async()=>{
  for(const platform of ["linux","win32"]){
    const denied=error("EPERM"),h=harness(platform,()=>{throw denied});
    await assert.rejects(signalOwnedRuntime(pid,"SIGKILL",h.ports),e=>e===denied);assert.equal(h.calls.length,1);
  }
  const denied=error("EPERM"),h=harness("darwin",(_target,signal)=>{throw signal===0?error("EIO"):denied});
  await assert.rejects(signalOwnedRuntime(pid,"SIGKILL",h.ports),e=>e===denied);assert.equal(h.calls.length,2);assert.deepEqual(h.waits,[]);
});
test("invalid, broadcast and self PID targets are rejected before signalling",async()=>{
  const h=harness("darwin",()=>assert.fail("must not signal"));
  for(const bad of [0,1,-1,-pid,NaN,Infinity,1.5,process.pid])await assert.rejects(signalOwnedRuntime(bad,"SIGTERM",h.ports),/Invalid owned runtime PID/);
  assert.deepEqual(h.calls,[]);
});
