import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Local login export must use a private direct directory.");
  await chmod(path, 0o700);
}
async function optionalFile(path: string): Promise<string | undefined> {
  let info;
  try { info = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error("Local login export requires a small direct regular file.");
  return await readFile(path, "utf8");
}
async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, contents, { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

/** Export only provider login files, never histories, projects, skills or CLI executables.
 * A separate writable copy supports token refresh without modifying the Mac login.
 * Do not overwrite a refreshed copy until the source login actually changes. */
export async function exportLocalDockerAuth(settingsPath: string, options: { home?: string; codexHome?: string } = {}): Promise<string[]> {
  const home = options.home ?? homedir(), codexHome = options.codexHome ?? (process.env.CODEX_HOME?.trim() || join(home, ".codex"));
  const root = join(dirname(settingsPath), "local-docker-auth");
  await privateDirectory(root);
  const mounts: string[] = [];
  for (const item of [
    { key: "codex", source: join(codexHome, "auth.json"), filename: "auth.json", destination: "/root/.codex" },
    { key: "claude", source: join(home, ".claude", ".credentials.json"), filename: ".credentials.json", destination: "/root/.claude" },
  ]) {
    const directory = join(root, item.key); await privateDirectory(directory);
    const content = await optionalFile(item.source), target = join(directory, item.filename), stamp = join(root, `${item.key}-source.sha256`);
    if (content === undefined) { await rm(target, { force: true }); await rm(stamp, { force: true }); }
    else {
      try { const value: unknown = JSON.parse(content); if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(); }
      catch { throw new Error("Local login file is invalid; the existing export was retained."); }
      const digest = createHash("sha256").update(content).digest("hex");
      if (await optionalFile(stamp) !== digest || await optionalFile(target) === undefined) {
        await atomicWrite(target, content); await atomicWrite(stamp, digest);
      }
    }
    if (item.key === "codex") {
      const config = await optionalFile(join(codexHome, "config.toml"));
      const lines = ["model", "model_reasoning_effort"].flatMap(key => {
        const value = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"'\\r\\n]+)["']`, "m").exec(config ?? "")?.[1];
        return value == null ? [] : [`${key} = ${JSON.stringify(value)}`];
      });
      await atomicWrite(join(directory, "config.toml"), lines.join("\n") + "\n");
    }
    // Always mount the private export, including an absent login: this prevents
    // an image/previous-container login from silently becoming the selected one.
    if (directory.includes(",") || /[\r\n]/.test(directory)) throw new Error("Local login export path cannot contain commas or newlines.");
    mounts.push("--mount", `type=bind,src=${directory},dst=${item.destination}`);
  }
  return mounts;
}
