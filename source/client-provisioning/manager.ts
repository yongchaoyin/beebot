import { mkdtemp, writeFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PreflightError, parseTarget, readHostKey, HOST_PROBE, parseHostReport, summarizeHost, type SshTarget } from "./preflight.js";
import { runBounded, type ProcessRunner } from "./process.js";

import { previewInstallation, type TrustedInspection } from "./install-plan.js";

type Challenge = { id: string; target: SshTarget; fingerprint: string; key: string; expiresAt: number };
export class ServerPreflight {
  private challenge: Challenge | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private inspection: TrustedInspection | undefined;
  private identity: string | undefined;
  constructor(private readonly run: ProcessRunner = runBounded, private readonly now = Date.now) {}
  cancel(): void { this.generation++; this.inspection = undefined; this.challenge = undefined; this.controller?.abort(); this.controller = undefined; }
  async setIdentity(path: string | undefined): Promise<void> {
    this.cancel();
    const at = this.generation;
    if (path !== undefined) {
      if (!isAbsolute(path) || /[\0\r\n%]/.test(path)) throw new PreflightError("INVALID_KEY_FILE");
      const stat = await lstat(path).catch(() => { throw new PreflightError("INVALID_KEY_FILE"); });
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new PreflightError("INVALID_KEY_FILE");
      if (at !== this.generation) throw new PreflightError("CANCELLED");
      this.identity = path; // Only the path from a native picker; never read key bytes.
    } else this.identity = undefined;
  }
  previewInstall(input: unknown) { return previewInstallation(this.inspection, input, this.now()); }
  private operation() { this.cancel(); return { at: this.generation, controller: this.controller = new AbortController() }; }
  async scan(input: unknown) {
    const target = parseTarget(input), { at, controller } = this.operation();
    const result = await this.run({ program: "/usr/bin/ssh-keyscan", args: ["-T", "5", "-p", String(target.port), "-t", "ed25519", target.host], signal: controller.signal, timeoutMs: 8000, maxBytes: 8192 });
    if (at !== this.generation) throw new PreflightError("CANCELLED");
    if (result.status !== 0) throw new PreflightError("NO_HOST_KEY");
    const key = readHostKey(result.stdout);
    const challenge: Challenge = { ...key, target, id: randomUUID(), expiresAt: this.now() + 300000 };
    this.challenge = challenge;
    return { id: challenge.id, target, fingerprint: challenge.fingerprint, keyType: "ed25519", expiresAt: challenge.expiresAt };
  }
  async inspect(id: unknown, fingerprint: unknown) {
    const challenge = this.challenge;
    if (!challenge || id !== challenge.id || this.now() >= challenge.expiresAt) throw new PreflightError("EXPIRED_CHALLENGE");
    if (fingerprint !== challenge.fingerprint) throw new PreflightError("FINGERPRINT_MISMATCH");
    const identity = this.identity, { at, controller } = this.operation(); // Consume once, even if SSH fails.
    const directory = await mkdtemp(join(tmpdir(), "beebot-preflight-"));
    try {
      const knownHosts = join(directory, "known_hosts");
      await writeFile(knownHosts, `beebot-preflight,[beebot-preflight]:${challenge.target.port} ssh-ed25519 ${challenge.key}\n`, { mode: 0o600, flag: "wx" });
      if (at !== this.generation) throw new PreflightError("CANCELLED");
      const options = [
        "BatchMode=yes", "ConnectionAttempts=1", "ConnectTimeout=8", "ServerAliveInterval=5", "ServerAliveCountMax=2",
        "StrictHostKeyChecking=yes", `UserKnownHostsFile=${JSON.stringify(knownHosts)}`, "GlobalKnownHostsFile=/dev/null", "HostKeyAlias=beebot-preflight",
        "UpdateHostKeys=no", "VerifyHostKeyDNS=no", "CheckHostIP=no", "ForwardAgent=no", "ForwardX11=no", "ClearAllForwardings=yes", "PermitLocalCommand=no",
        "ProxyCommand=none", "ProxyJump=none", "ControlMaster=no", "ControlPath=none", "ControlPersist=no", "HostKeyAlgorithms=ssh-ed25519",
        "PasswordAuthentication=no", "KbdInteractiveAuthentication=no", "PreferredAuthentications=publickey", "NumberOfPasswordPrompts=0", "LogLevel=ERROR",
        ...(identity ? ["IdentitiesOnly=yes", "IdentityAgent=none"] : ["IdentityFile=none", "IdentitiesOnly=no"]),
      ];
      const args = ["-F", "/dev/null", "-T", "-p", String(challenge.target.port), "-l", challenge.target.user, ...options.flatMap(option => ["-o", option]), ...(identity ? ["-i", identity] : []), "--", challenge.target.host, "sh -s"];
      const result = await this.run({ program: "/usr/bin/ssh", args, input: HOST_PROBE, signal: controller.signal, timeoutMs: 30000, maxBytes: 16384 });
      if (at !== this.generation) throw new PreflightError("CANCELLED");
      if (result.status !== 0) {
        const code = /HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No ED25519 host key is known/i.test(result.stderr) ? "HOST_KEY_CHANGED"
          : /Permission denied|sign_and_send_pubkey|Load key|no such identity/i.test(result.stderr) ? "AUTHENTICATION_FAILED" : "CONNECTION_FAILED";
        throw new PreflightError(code); // Never return remote stderr (banners may contain credentials).
      }
      const report = parseHostReport(result.stdout), checkedAt = this.now();
      this.inspection = { target: challenge.target, fingerprint: challenge.fingerprint, checkedAt, report: { ...report } };
      return { target: challenge.target, fingerprint: challenge.fingerprint, checkedAt, ...summarizeHost(report) };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
