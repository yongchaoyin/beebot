import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadContinuityRuntime } from "./helpers/load-continuity-runtime.mjs";

async function harness(t) {
  const runtime = await loadContinuityRuntime(t), rows = new Map([['a', { id: 'a', name: 'A' }], ['b', { id: 'b', name: 'B' }]]), calls = [], opened = [];
  const dir = id => join(runtime.directory, id);
  for (const id of rows.keys()) mkdirSync(dir(id), { recursive: true });
  const summary = row => ({ ...row, ...(runtime.readSandGroupConfig(dir(row.id)) ? { isGroup: true, memberIds: runtime.readSandGroupConfig(dir(row.id)).memberIds } : {}) });
  const tm = {
    sessionStore: { listAgents: async () => [...rows.values()].map(summary), getAgentDir: dir },
    roster: { reserveSnapshotStamp: () => 1, finalizeSummaryForRpc: value => value, emitAgents: async () => {} },
    productAnalytics: { trackEvent() {} },
    switchAgent: async id => { opened.push(id); return []; },
    createAgent: async (profile, origin, options) => {
      calls.push({ profile, origin, options }); const id = `group-${calls.length}`;
      mkdirSync(dir(id), { recursive: true });
      options.configureAgentDir(dir(id));
      assert.ok(runtime.readSandGroupConfig(dir(id)), 'group is configured before its first visible summary');
      assert.equal(options.isIntroductionSuppressed, true);
      const row = { id, ...profile }; rows.set(id, row);
      return { agent: summary(row), transcript: [] };
    },
  };
  return { runtime, tm, rows, calls, opened, dir, glue: new runtime.GroupChatGlue(tm) };
}

test('the same colleagues can create distinct project groups', async t => {
  const h = await harness(t);
  const one = await h.glue.createGroup({ name: 'Project one', memberIds: ['a','b'] });
  const two = await h.glue.createGroup({ name: 'Project two', memberIds: ['a','b'] });
  assert.notEqual(one.agent.id, two.agent.id); assert.equal(h.calls.length, 2);
});

test('concurrent and restarted retries use a persisted creation identity', async t => {
  const h = await harness(t), args = { name: 'Team', memberIds: ['a','b'], clientNonce: randomUUID() };
  const results = await Promise.all([h.glue.createGroup(args), h.glue.createGroup(args)]);
  assert.equal(h.calls.length, 1); assert.equal(results[0].agent.id, results[1].agent.id);
  const next = new h.runtime.GroupChatGlue(h.tm);
  const after = await next.createGroup(args);
  assert.equal(after.agent.id, results[0].agent.id); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.opened, [after.agent.id]);
  await assert.rejects(next.createGroup({ ...args, name: 'Changed scope' }), /different group details/);
  assert.equal(h.calls.length, 1);
});

test('invalid member selections fail before creating or filtering a group', async t => {
  const h = await harness(t);
  const group = await h.glue.createGroup({ name: 'Existing', memberIds: ['a'] });
  for (const memberIds of [[], ['a','missing'], ['a','a'], [' a'], [group.agent.id], ['a','b','c','d','e','f','g']]) {
    await assert.rejects(h.glue.createGroup({ name: 'Invalid', memberIds }));
  }
  await assert.rejects(h.glue.createGroup({ name: 'Invalid', memberIds: ['a'], clientNonce: '../invalid' }));
  assert.equal(h.calls.length, 1);
});

test('membership edits retain the original creation receipt and are all-or-nothing', async t => {
  const h = await harness(t), args = { name: 'Team', memberIds: ['a'], clientNonce: randomUUID() };
  const group = await h.glue.createGroup(args), id = group.agent.id;
  const receipt = h.runtime.readSandGroupConfig(h.dir(id)).creation;
  await h.glue.setGroupMembers(id, ['a','b']);
  assert.deepEqual(h.runtime.readSandGroupConfig(h.dir(id)).creation, receipt);
  for (const ids of [[], ['a','missing'], ['a','a'], ['a',id]]) await assert.rejects(h.glue.setGroupMembers(id, ids));
  assert.deepEqual(h.runtime.readSandGroupConfig(h.dir(id)).memberIds, ['a','b']);
  const retry = await new h.runtime.GroupChatGlue(h.tm).createGroup(args);
  assert.equal(retry.agent.id, id); assert.equal(h.calls.length, 1);
});
