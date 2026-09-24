import { mkdtemp, rm, symlink, rename, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { outputApp, outputDir, repoRoot } from "./lib/config.mjs";
import { run } from "./lib/process.mjs";
import { SYSTEM_TOOLS } from "./lib/system-tools.mjs";

if (process.platform !== "darwin") throw new Error("Build the BeeBot disk image on macOS after packaging the app.");
await run("python3", [path.join(repoRoot, "scripts/lib/rebrand-macos.py"), outputApp, "--verify"]);
await run(SYSTEM_TOOLS.codesign, ["--verify", "--deep", "--strict", outputApp]);
const staging = await mkdtemp(path.join(tmpdir(), "beebot-dmg-"));
const temporary = path.join(outputDir, ".BeeBot-building.dmg"), target = path.join(outputDir, "BeeBot.dmg");
try {
  // Deliberately do not copy the reference DMG's background, DS_Store or installer.
  await run(SYSTEM_TOOLS.ditto, [outputApp, path.join(staging, "BeeBot.app")]);
  await symlink("/Applications", path.join(staging, "Applications"));
  if (JSON.stringify((await readdir(staging)).sort()) !== JSON.stringify(["Applications", "BeeBot.app"])) throw new Error("Unexpected installer payload.");
  await rm(temporary, { force: true });
  await run(SYSTEM_TOOLS.hdiutil, ["create", "-volname", "BeeBot", "-srcfolder", staging, "-format", "UDZO", "-ov", temporary]);
  await run(SYSTEM_TOOLS.hdiutil, ["verify", temporary]);
  await rename(temporary, target);
  console.log(`Disk image: ${target}. This local ad-hoc build is not Developer-ID signed or notarized.`);
} finally {
  await rm(staging, { recursive: true, force: true });
  await rm(temporary, { force: true });
}
