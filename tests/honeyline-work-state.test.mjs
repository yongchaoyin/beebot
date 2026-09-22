import assert from "node:assert/strict";
import test from "node:test";
import { needsUserInput, workLabel } from "../frontend/src/honeyline/status.ts";
const cases = [
  [{}, null],
  [{ currentActivity: { verb: "reading" } }, null],
  [{ awaitingUserResponse: false }, null],
  [{ awaitingUserResponse: "waiting" }, null],
  [{ waitingReason: "Waiting for another agent" }, ["waiting", "等待中", "Waiting"]],
  [{ waitingReason: "Permission needed" }, ["waiting", "等待中", "Waiting"]],
  [{ awaitingUserResponse: true }, ["attention", "需要你确认", "Needs your input"]],
  [{ awaitingUserResponse: { reason: "Send an email" } }, ["attention", "需要你确认", "Needs your input"]],
  [{ waiting: { kind: "user" } }, ["attention", "需要你确认", "Needs your input"]],
  [{ waiting: { kind: "agent", targetName: "小研" }, isRunning: true }, ["waiting", "等待 小研", "Waiting for 小研"]],
  [{ waiting: { kind: "agent" } }, ["waiting", "等待同事", "Waiting for a colleague"]],
  [{ waiting: { kind: "resource" } }, ["waiting", "已排队", "Queued"]],
  [{ workPhase: "queued", isRunning: true }, ["waiting", "已排队", "Queued"]],
  [{ workPhase: "review" }, ["waiting", "已提交，待验收", "Submitted · awaiting review"]],
  [{ workPhase: "uncertain", isRunning: true }, ["unknown", "结果待核查", "Outcome needs verification"]],
  [{ workPhase: "failed" }, ["error", "未能完成", "Could not finish"]],
  [{ workPhase: "succeeded", isRunning: true }, null],
  [{ workPhase: "cancelled", isRunning: true }, null],
  [{ connectionState: "offline", awaitingUserResponse: true, isRunning: true }, ["unknown", "连接已断开，进度待确认", "Disconnected · progress unconfirmed"]],
  [{ isRunning: true }, ["working", "正在处理", "Working"]],
  [{ workPhase: "running" }, ["working", "正在处理", "Working"]],
  [{ isComposingMessage: true }, ["working", "正在回复", "Writing a reply"]],
];
for (const [index, [input, expected]] of cases.entries()) test(`work facts ${index + 1}: ${JSON.stringify(input)}`, () => {
  const actual = workLabel(input);
  assert.deepEqual(actual == null ? null : [actual.state, actual.zh, actual.en], expected);
});
test("a reason string is not authority, while structured user ownership is", () => {
  assert.equal(needsUserInput({ waitingReason: "Awaiting approval" }), false);
  assert.equal(needsUserInput({ waiting: { kind: "agent" } }), false);
  assert.equal(needsUserInput({ waiting: { kind: "user" } }), true);
});

test("typed waiting owner takes precedence over cached legacy flags", () => {
  assert.equal(workLabel({ waiting: { kind: "agent" }, awaitingUserResponse: { reason: "stale" } }).state, "waiting");
  assert.equal(needsUserInput({ awaitingUserResponse: [] }), false);
  assert.equal(workLabel({ waiting: { kind: "agent", targetName: 3 } }).en, "Waiting for a colleague");
  assert.equal(workLabel({ waitingReason: {} }), null);
});
