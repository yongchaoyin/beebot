import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function temporaryBeside(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.${randomBytes(8).toString("hex")}.part`);
}

function isReplaceBusy(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EXDEV";
}

/** Write `targetPath` without renaming over it when it already exists.
 *  Docker bind-mounted files (settings.json, box-secrets.json) break if renamed. */
export function writeFileReplaceSync(targetPath: string, data: string, options: { readonly mode?: number } = {}): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const temporaryPath = temporaryBeside(targetPath);
  writeFileSync(temporaryPath, data, { encoding: "utf8", mode: options.mode });
  try {
    if (existsSync(targetPath)) {
      writeFileSync(targetPath, data, { encoding: "utf8", mode: options.mode });
      return;
    }
    renameSync(temporaryPath, targetPath);
  } catch (error) {
    if (!isReplaceBusy(error)) throw error;
    writeFileSync(targetPath, data, { encoding: "utf8", mode: options.mode });
  } finally {
    try { unlinkSync(temporaryPath); } catch { /* leftover temps are safe to ignore */ }
  }
}

export async function writeFileAtomic(targetPath: string, data: Uint8Array | string, options: { readonly mode?: number } = {}): Promise<void> {
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = temporaryBeside(targetPath);
  const handle = await open(temporaryPath, "wx", options.mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  await handle.close();
  try { await rename(temporaryPath, targetPath); }
  catch (error) {
    try {
      if (isReplaceBusy(error)) {
        await writeFile(targetPath, data, { encoding: typeof data === "string" ? "utf8" : undefined, mode: options.mode });
        return;
      }
      throw error;
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }
  }
}
