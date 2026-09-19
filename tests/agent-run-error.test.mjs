import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Code, ConnectError } from "@connectrpc/connect";
import { build } from "esbuild";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "beebot-agent-run-error-"));
after(() => rm(temporary, { recursive: true, force: true }));
const output = path.join(temporary, "errors.mjs");
await build({
  stdin: {
    contents: `
      export * from "./source/host/extensions/transcript/agent-run-error.ts";
      export { classifyAgentError, connectCodeOf } from "./source/host/extensions/transcript/turn-runtime.ts";
      export { SandCredentialsWaitingError, SAND_SHORTLIVED_CREDS_WAITING_MESSAGE } from "./source/host/extensions/auth/auth-service.ts";
      export { ErrorDetails } from "./source/packages/proto/generated/aiserver/v1/utils_pb.ts";
    `,
    resolveDir: repo,
  },
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node26",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const errors = await import(pathToFileURL(output).href);

test("a real ConnectError preserves the credential failure through classification and display", () => {
  const cause = new errors.SandCredentialsWaitingError(errors.SAND_SHORTLIVED_CREDS_WAITING_MESSAGE);
  const error = ConnectError.from(cause);

  assert.equal(errors.findBackendConnectError(error), null);
  assert.equal(errors.findBackendConnectError(error, false), error);
  assert.equal(errors.connectCodeOf(error), "Unknown");
  assert.deepEqual(errors.classifyAgentError(error), { code: "SAND-E0405", connectCode: "Unknown" });
  assert.equal(errors.formatAgentRunError(error), error.message);
  assert.deepEqual(errors.describeAgentRunError(error), { detail: error.message });
  assert.equal(error.cause, cause);
  assert.equal(error.rawMessage, cause.message);
  assert.deepEqual(errors.describeAgentRunError(cause), { detail: cause.message });
  assert.deepEqual(errors.classifyAgentError(cause), { code: "SAND-E0407" });
});

test("real protobuf backend details retain their title, message and actions", () => {
  const detail = new errors.ErrorDetails({ details: {
    title: "Sign in required",
    detail: "Authorize this model provider before retrying.",
    buttons: [{ label: "Provider settings", action: { case: "url", value: { url: "https://example.com/settings" } } }],
  } });
  for (const wireDetail of [detail, { type: errors.ErrorDetails.typeName, value: detail.toBinary() }]) {
    const error = new ConnectError("backend rejected the request", Code.Unauthenticated, undefined, [wireDetail]);
    assert.equal(errors.findBackendConnectError(error), error);
    assert.equal(errors.formatAgentRunError(error), "Sign in required\n\nAuthorize this model provider before retrying.");
    assert.deepEqual(errors.describeAgentRunError(error), {
      title: "Sign in required",
      detail: "Authorize this model provider before retrying.",
      actions: [{ kind: "open-url", label: "Provider settings", url: "https://example.com/settings" }],
    });
    assert.deepEqual(errors.classifyAgentError(error), { code: "SAND-E0405", connectCode: "Unauthenticated" });
  }
});

test("nested and aggregate errors prefer backend details without looping on cyclic causes", () => {
  const detail = new errors.ErrorDetails({ details: { title: "Request rejected", detail: "Check the selected model." } });
  const detailed = new ConnectError("inner error", Code.InvalidArgument, undefined, [detail]);
  const first = new ConnectError("outer error", Code.Unknown);
  const aggregate = new AggregateError([first, detailed], "several failures");
  first.cause = aggregate;
  const wrapped = new Error("run failed", { cause: aggregate });
  assert.equal(errors.findBackendConnectError(wrapped), detailed);
  assert.equal(errors.connectCodeOf(wrapped), "InvalidArgument");
  assert.equal(errors.formatAgentRunError(wrapped), "Request rejected\n\nCheck the selected model.");

  first.cause = first;
  assert.equal(errors.findBackendConnectError(first), null);
  assert.equal(errors.findBackendConnectError(first, false), first);
});

test("malformed optional Connect details cannot replace the original failure", () => {
  for (const detail of [
    { type: errors.ErrorDetails.typeName, value: Uint8Array.of(0xff) },
    // This corrupt in-memory detail throws inside the real findDetails method.
    null,
  ]) {
    const error = new ConnectError("original provider failure", Code.PermissionDenied, undefined, [detail]);
    assert.equal(errors.findBackendConnectError(error), null);
    assert.equal(errors.findBackendConnectError(error, false), error);
    assert.deepEqual(errors.classifyAgentError(error), { code: "SAND-E0405", connectCode: "PermissionDenied" });
    assert.deepEqual(errors.describeAgentRunError(error), { detail: "[permission_denied] original provider failure" });
  }
});
