import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPackage, extractFile } from "@electron/asar";
import { parse } from "acorn";
import { createRendererArtifactProvenance } from "../scripts/lib/clean-build.mjs";
import { cachedRuntimeApp, sourceAppDir, upstreamAsarSha256 } from "../scripts/lib/config.mjs";
import { verifyChecksumPinnedRendererPackage } from "../scripts/lib/macos-package-verification.mjs";
import { applyOriginalRendererRouterPatch } from "../scripts/lib/router-renderer-patch.mjs";

// Exercise the real CLI branch with actual renderer bytes, without launching an
// application or constructing unrelated native binaries/signatures in the fixture.
const source = await readFile(new URL("../scripts/verify.mjs", import.meta.url), "utf8");
const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
const modeGate = ast.body.find(node => node.type === "IfStatement"
  && source.slice(node.test.start, node.test.end) === 'rendererComposition?.mode === "clean-source"');
assert.ok(modeGate, "verify must distinguish clean source from the pinned renderer");
const pinnedGate = modeGate.alternate;
assert.equal(source.slice(pinnedGate.test.start, pinnedGate.test.end), 'rendererComposition?.mode === "checksum-pinned-artifact-runtime"');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const verifyPinnedBranch = new AsyncFunction("context", `
  const { compositionAudit, rendererProvenance, rendererComposition,
    rendererProvenancePath, upstreamAsarSha256, builtAsar, sourceAppDir,
    cachedRuntimeApp, path, extractFile, verifyChecksumPinnedRendererPackage } = context;
  ${source.slice(pinnedGate.consequent.start, pinnedGate.consequent.end)}
`);

test("packaged verification authenticates the adapted pinned renderer and rejects drift", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "beebot-verify-renderer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stage = path.join(directory, "stage");
  const rendererRoot = path.join(stage, "dist/renderer");
  await cp(path.join(sourceAppDir, "dist/renderer"), rendererRoot, { recursive: true });
  await applyOriginalRendererRouterPatch({ stageRoot: stage });
  const provenancePath = "dist/renderer-artifact-provenance.json";
  const provenance = await createRendererArtifactProvenance();
  const rendererComposition = { runtime: "renderer", mode: "checksum-pinned-artifact-runtime", provenance: provenancePath };
  await writeFile(path.join(stage, provenancePath), JSON.stringify(provenance));
  await writeFile(path.join(stage, "dist/reconstruction-build.json"), JSON.stringify({ runtimeComposition: [rendererComposition] }));
  const compositionAudit = { rendererComposition: { artifactRuntimeAcceptance: {
    verdict: "verified", provenance: provenancePath,
    fileCount: provenance.fileCount, inventorySha256: provenance.inventorySha256,
  } } };
  let sequence = 0;
  async function verify(stageRoot = stage) {
    const builtAsar = path.join(directory, `fixture-${++sequence}.asar`);
    await createPackage(stageRoot, builtAsar);
    const rendererProvenance = JSON.parse(extractFile(builtAsar, provenancePath).toString("utf8"));
    return verifyPinnedBranch({ compositionAudit, rendererProvenance, rendererComposition,
      rendererProvenancePath: provenancePath, upstreamAsarSha256, builtAsar,
      sourceAppDir, cachedRuntimeApp, path, extractFile, verifyChecksumPinnedRendererPackage });
  }

  await t.test("current green icon and declared adapters pass without claiming clean source", async () => {
    const icon = await readFile(path.join(rendererRoot, "assets/beebot-app-icon.svg"), "utf8");
    assert.equal(icon, await readFile(new URL("../branding/beebot-app-icon.svg", import.meta.url), "utf8"));
    assert.match(icon, /fill="#00C972"/);
    await assert.rejects(readFile(path.join(rendererRoot, "assets/app-icon-C7NKj2u7.png")), { code: "ENOENT" });
    await verify();
    assert.equal(rendererComposition.mode, "checksum-pinned-artifact-runtime");
  });
  await t.test("missing owned icon fails the exact output inventory", async () => {
    const target = path.join(rendererRoot, "assets/beebot-app-icon.svg");
    const bytes = await readFile(target);
    await rm(target);
    try { await assert.rejects(verify(), /packaged inventory contains missing or undeclared files/); }
    finally { await writeFile(target, bytes); }
  });
  await t.test("modified renderer JavaScript fails the reproduced byte check", async () => {
    const target = path.join(rendererRoot, "assets/index-UbX-y3il.js");
    const bytes = await readFile(target);
    await writeFile(target, Buffer.concat([bytes, Buffer.from("\n/* undeclared change */\n")]));
    try { await assert.rejects(verify(), /packaged bytes differ at assets\/index-UbX-y3il\.js/); }
    finally { await writeFile(target, bytes); }
  });
  await t.test("undeclared files cannot be authorized by a valid upstream manifest", async () => {
    const target = path.join(rendererRoot, "assets/undeclared.js");
    await writeFile(target, "export const extra = true;");
    try { await assert.rejects(verify(), /packaged inventory contains missing or undeclared files/); }
    finally { await rm(target); }
  });
  await t.test("a forged upstream identity is rejected before output acceptance", async () => {
    await writeFile(path.join(stage, provenancePath), JSON.stringify({ ...provenance, upstreamAppAsarSha256: "0".repeat(64) }));
    try { await assert.rejects(verify(), /provenance has the wrong identity/); }
    finally { await writeFile(path.join(stage, provenancePath), JSON.stringify(provenance)); }
  });
  await t.test("removing Presence provenance cannot downgrade current BeeBot verification", async () => {
    const target = path.join(stage, "dist/renderer-router-extension.json");
    const bytes = await readFile(target), extension = JSON.parse(bytes.toString("utf8"));
    delete extension.presence;
    await writeFile(target, JSON.stringify(extension));
    try { await assert.rejects(verify(), /requires Presence adapter provenance version 1/); }
    finally { await writeFile(target, bytes); }
  });
  await t.test("a legacy extension cannot authorize self-reported patched JavaScript", async () => {
    // A complete canonical inventory with one changed original chunk satisfies
    // the historical helper format. Current BeeBot must require reproduction.
    const legacy = path.join(directory, "legacy");
    await cp(path.join(sourceAppDir, "dist/renderer"), path.join(legacy, "dist/renderer"), { recursive: true });
    await writeFile(path.join(legacy, provenancePath), JSON.stringify(provenance));
    await cp(path.join(stage, "dist/reconstruction-build.json"), path.join(legacy, "dist/reconstruction-build.json"));
    const relative = "assets/index-UbX-y3il.js", original = provenance.files.find(file => file.path === relative);
    assert.ok(original);
    const target = path.join(legacy, "dist/renderer", relative);
    const patched = Buffer.concat([await readFile(target), Buffer.from("\n/* not a declared BeeBot adapter */\n")]);
    await writeFile(target, patched);
    await writeFile(path.join(legacy, "dist/renderer-router-extension.json"), JSON.stringify({
      schemaVersion: 1, mode: "original-renderer-settings-extension", features: [], transformations: [],
      chunks: [{ role: "registry", path: `dist/renderer/${relative}`,
        original: { bytes: original.bytes, sha256: original.sha256 },
        patched: { bytes: patched.length, sha256: createHash("sha256").update(patched).digest("hex") } }],
    }));
    await assert.rejects(verify(legacy), /requires Presence adapter provenance version 1/);
  });
});
