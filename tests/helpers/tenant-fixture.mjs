import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const buildDir = await mkdtemp(path.join(os.tmpdir(), "beebot-tenant-code-"));
await build({
  stdin: { contents: [
    'export * from "./source/hosting/tenant-crypto.ts";',
    'export * from "./source/hosting/tenant-directory.ts";',
    'export * from "./source/hosting/tenant-workspaces.ts";',
    'export * from "./source/node/control-store.ts";',
    'export * from "./source/node/control-service.ts";',
  ].join("\n"), resolveDir: fileURLToPath(new URL("../../", import.meta.url)), sourcefile: "tenant-test-entry.ts" },
  outfile: path.join(buildDir, "tenant.mjs"), bundle: true, platform: "node", format: "esm", target: "node26",
});
export const api = await import(pathToFileURL(path.join(buildDir, "tenant.mjs")));
test.after(() => rm(buildDir, { recursive: true, force: true }));
export const issuer = "https://identity.example.test";
export const identity = subject => ({ issuer, subject, deviceRole: "admin", botIds: "*" });
export async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "beebot-tenants-"));
  const wrapper = new api.LocalTenantKeyWrapper("test-only-external-kek", randomBytes(32));
  const directory = new api.TenantDirectory(dir, [issuer, "https://other-issuer.example.test"]);
  const workspaces = new api.TenantWorkspaces(directory, wrapper, options.maxOpen ?? 32, options.maxBots ?? 100, options.keyLeaseMs ?? 60_000);
  t.after(async () => { await workspaces.close(); directory.close(); wrapper.close(); await rm(dir, { recursive: true, force: true }); });
  const a = identity("alice"), b = identity("bob");
  const tenantA = await workspaces.provision(() => a, "provision-alice", "Alice private space");
  const tenantB = await workspaces.provision(() => b, "provision-bob", "Bob private space");
  return { dir, directory, wrapper, workspaces, a, b, tenantA, tenantB,
    scopeA: directory.scope(() => a, tenantA), scopeB: directory.scope(() => b, tenantB) };
}
