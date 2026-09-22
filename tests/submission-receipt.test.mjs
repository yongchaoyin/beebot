import assert from "node:assert/strict";
import test from "node:test";
import { lookupSubmissionReceipt, verifiedSubmissionOutcome } from "../frontend/src/recovered/features/conversation/workspace/submission-receipt.ts";
import { createTranscriptAcknowledgementController } from "../frontend/src/recovered/features/conversation/workspace/acknowledgement.ts";
const expected = { accountSlot: "host", agentId: "room", nonce: "nonce" };
const record = { accountSlot: "host", agentId: "room", clientNonce: "nonce", status: "accepted" };
for (const [status, result] of [["accepted", "sent"], ["rejected", "not-sent"], ["pending", null], ["future-state", null]]) {
  test(`receipt: ${status} maps to ${result}`, () => assert.equal(verifiedSubmissionOutcome({ outcome: "found", record: { ...record, status } }, expected), result));
}
for (const value of [null, "accepted", {}, { outcome: "not-found" }, { outcome: "unknown-durability" }, { outcome: "found" }, { outcome: "found", record: [] }]) {
  test(`receipt absence is never a retry instruction: ${JSON.stringify(value)}`, () => assert.equal(verifiedSubmissionOutcome(value, expected), null));
}
for (const field of ["accountSlot", "agentId", "clientNonce"]) test(`receipt from another ${field} cannot advance the lane`, () => {
  assert.equal(verifiedSubmissionOutcome({ outcome: "found", record: { ...record, [field]: "other" } }, expected), null);
});
test("unknown acknowledgement cannot be retried as a failed send, but can be accepted or explicitly rejected", () => {
  const controller = createTranscriptAcknowledgementController();
  controller.setScope("account", "room");
  controller.insertOptimistic({ accountSlot: "account", agentId: "room", nonce: "n", entries: [{ id: "n", clientNonce: "n", kind: "message" }], phase: "pending" });
  assert.equal(controller.markUncertain("account", "n"), true);
  assert.equal(controller.retryFailed({ accountSlot: "account", agentId: "room", nonce: "n", freshNonce: "next", entries: [{ id: "next", clientNonce: "next", kind: "message" }] }), false);
  assert.equal(controller.markAcceptedAwaitingEcho("account", "n"), true);
  assert.equal(controller.markUncertain("account", "n"), false, "late failure cannot erase acceptance");
  controller.dispose();
});

test("receipt lookup timeout and transport rejection stay unknown without dispatch or replay", async () => {
  let calls = 0; let finish;
  const slow = () => { calls += 1; return new Promise(resolve => { finish = resolve; }); };
  assert.equal(await lookupSubmissionReceipt(slow, expected, 5), null);
  finish({ outcome: "found", record });
  assert.equal(calls, 1);
  assert.equal(await lookupSubmissionReceipt(() => Promise.reject(new Error("offline")), expected, 100), null);
  assert.equal(await lookupSubmissionReceipt(() => Promise.resolve({ outcome: "found", record }), expected, 100), "sent");
});
