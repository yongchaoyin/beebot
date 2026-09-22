import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractFile, listPackage, statFile } from "@electron/asar";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function inventory(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await inventory(root, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Unsupported Honeyline renderer entry: ${relative}`);
  }
  return result.sort();
}
/** Called only after the canonical upstream inventory has been authenticated.
 * Rebuild the exact declared extensions from that inventory and current source;
 * do not trust a manifest to authorize arbitrary extra code in the archive. */
export async function verifyHoneylineRendererArchive({ archivePath, sourceRendererRoot, extension }) {
  const stage = await mkdtemp(path.join(tmpdir(), "beebot-honeyline-verify-"));
  try {
    const root = path.join(stage, "dist/renderer");
    await cp(sourceRendererRoot, root, { recursive: true });
    const { applyOriginalRendererRouterPatch } = await import("./router-renderer-patch.mjs");
    await applyOriginalRendererRouterPatch({ stageRoot: stage });
    const rebuilt = JSON.parse(await readFile(path.join(stage, "dist/renderer-router-extension.json"), "utf8"));
    if (JSON.stringify(extension) !== JSON.stringify(rebuilt)) throw new Error("Honeyline extension differs from the reproducible source build");
    const expected = await inventory(root);
    const actual = listPackage(archivePath).map(value => value.replace(/^\/+/, "")).filter(value => {
      if (!value.startsWith("dist/renderer/")) return false;
      return typeof statFile(archivePath, value).size === "number";
    }).map(value => value.slice("dist/renderer/".length)).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Honeyline packaged inventory contains missing or undeclared files");
    for (const relative of expected) {
      const wanted = await readFile(path.join(root, relative));
      const packaged = extractFile(archivePath, `dist/renderer/${relative}`);
      if (packaged.length !== wanted.length || hash(packaged) !== hash(wanted)) throw new Error(`Honeyline packaged bytes differ at ${relative}`);
    }
    return { fileCount: expected.length, honeyline: rebuilt.honeyline, chatAssets: rebuilt.chatAssets, chunks: rebuilt.chunks };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
