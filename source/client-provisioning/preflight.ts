import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type SshTarget = Readonly<{ host: string; port: number; user: string }>;
export type PreflightCode = "INVALID_TARGET" | "SSH_UNAVAILABLE" | "NO_HOST_KEY" | "AMBIGUOUS_HOST_KEY" | "INVALID_HOST_KEY" | "EXPIRED_CHALLENGE" | "FINGERPRINT_MISMATCH" | "AUTHENTICATION_FAILED" | "HOST_KEY_CHANGED" | "CONNECTION_FAILED" | "TIMEOUT" | "OUTPUT_LIMIT" | "CANCELLED" | "INVALID_REPORT" | "INVALID_KEY_FILE";
export class PreflightError extends Error {
  constructor(readonly code: PreflightCode) { super(code); this.name = "PreflightError"; }
}
export function parseTarget(input: unknown): SshTarget {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PreflightError("INVALID_TARGET");
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some(key => !["host", "port", "user"].includes(key))) throw new PreflightError("INVALID_TARGET");
  const { host, user, port } = record;
  if (typeof host !== "string" || host.length > 253 || !host.length || host.trim() !== host ||
      (!isIP(host) && !host.split(".").every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) ||
      typeof user !== "string" || !/^[a-z_][a-z0-9_-]{0,31}\$?$/i.test(user) ||
      !Number.isSafeInteger(port) || Number(port) < 1 || Number(port) > 65535) throw new PreflightError("INVALID_TARGET");
  // No ssh-config aliases, URL credentials, option injection, CIDR scans or lists.
  return Object.freeze({ host: host.toLowerCase(), user, port: port as number });
}
export function readHostKey(output: string): { key: string; fingerprint: string } {
  if (Buffer.byteLength(output) > 8192) throw new PreflightError("OUTPUT_LIMIT");
  const keys = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const match = /^\S+ ssh-ed25519 ([A-Za-z0-9+/]+={0,2})$/.exec(line);
    if (!match) throw new PreflightError("INVALID_HOST_KEY");
    const bytes = Buffer.from(match[1]!, "base64");
    if (bytes.toString("base64") !== match[1] || bytes.length !== 51 || bytes.readUInt32BE(0) !== 11 ||
        bytes.subarray(4, 15).toString() !== "ssh-ed25519" || bytes.readUInt32BE(15) !== 32) throw new PreflightError("INVALID_HOST_KEY");
    keys.add(match[1]!);
  }
  if (!keys.size) throw new PreflightError("NO_HOST_KEY");
  if (keys.size !== 1) throw new PreflightError("AMBIGUOUS_HOST_KEY");
  const key = [...keys][0]!;
  return { key, fingerprint: "SHA256:" + createHash("sha256").update(Buffer.from(key, "base64")).digest("base64").replace(/=+$/, "") };
}

// Fixed, non-privileged probe: no user-authored remote command, secret reads,
// installation, chmod, Docker mutations or firewall changes. The only persistent
// remote effects may be the SSH server's normal authentication/audit records.
export const HOST_PROBE = `set -eu
PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PATH
LC_ALL=C
export LC_ALL
unset ENV BASH_ENV CDPATH
os=$(uname -s 2>/dev/null || printf unknown)
case "$os" in Linux|Darwin) ;; *) os=other;; esac
arch=$(uname -m 2>/dev/null || printf unknown)
case "$arch" in x86_64|aarch64|arm64) ;; *) arch=other;; esac
bash_status=missing
command -v bash >/dev/null 2>&1 && bash_status=available
engine=missing
compose=missing
if command -v docker >/dev/null 2>&1; then
  engine=unavailable
  endpoint=
  if [ -n "\${DOCKER_HOST:-}" ]; then endpoint=$DOCKER_HOST
  else endpoint=$(docker context inspect --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null || true); fi
  case "$endpoint" in
    unix:///*)
      kind=$(docker --host "$endpoint" info --format '{{.OSType}}' 2>/dev/null || true)
      case "$kind" in linux) engine=local_linux;; '') ;; *) engine=unsupported;; esac
      docker --host "$endpoint" compose version >/dev/null 2>&1 && compose=available
      ;;
    '') ;;
    *) engine=remote_context;;
  esac
fi
home_status=unavailable
disk=unknown
installation=unknown
if [ -n "\${HOME:-}" ] && [ -d "$HOME" ]; then
  [ -w "$HOME" ] && home_status=writable || home_status=readonly
  disk=$(df -Pk "$HOME" 2>/dev/null | awk 'END {if ($4 ~ /^[0-9]+$/) print $4; else print "unknown"}')
  [ -n "$disk" ] || disk=unknown
  base="$HOME/.local/share/beebot"
  installation=absent
  if [ -L "$HOME/.local" ] || [ -L "$HOME/.local/share" ] || [ -L "$base" ] || [ -L "$base/server" ]; then installation=symlink
  elif [ -e "$base/server/.install.lock" ] || [ -L "$base/server/.install.lock" ]; then installation=locked
  elif [ -e "$base/server" ]; then
    installation=occupied
    if [ -f "$base/server/installation.manifest" ] && [ ! -L "$base/server/installation.manifest" ] && [ -f "$base/server/installation.id" ] && [ ! -L "$base/server/installation.id" ]; then installation=managed_present; fi
  fi
fi
printf 'BEEBOT_PREFLIGHT_V1\\nos=%s\\narch=%s\\nbash=%s\\nengine=%s\\ncompose=%s\\nhome=%s\\ndiskKiB=%s\\ninstallation=%s\\n' "$os" "$arch" "$bash_status" "$engine" "$compose" "$home_status" "$disk" "$installation"
`;
export type HostReport = {
  os: "Linux" | "Darwin" | "other";
  arch: "x86_64" | "aarch64" | "arm64" | "other";
  bash: "available" | "missing";
  engine: "missing" | "unavailable" | "local_linux" | "unsupported" | "remote_context";
  compose: "available" | "missing";
  home: "writable" | "readonly" | "unavailable";
  diskKiB: number | null;
  installation: "absent" | "managed_present" | "occupied" | "locked" | "symlink" | "unknown";
};
const choices = {
  os: ["Linux", "Darwin", "other"], arch: ["x86_64", "aarch64", "arm64", "other"],
  bash: ["available", "missing"], engine: ["missing", "unavailable", "local_linux", "unsupported", "remote_context"],
  compose: ["available", "missing"], home: ["writable", "readonly", "unavailable"],
  installation: ["absent", "managed_present", "occupied", "locked", "symlink", "unknown"],
} as const;
export function parseHostReport(output: string): HostReport {
  if (Buffer.byteLength(output) > 8192 || output.includes("\r")) throw new PreflightError("INVALID_REPORT");
  const lines = output.split("\n");
  if (lines.pop() !== "" || lines.shift() !== "BEEBOT_PREFLIGHT_V1" || lines.length !== 8) throw new PreflightError("INVALID_REPORT");
  const parsed: Record<string, unknown> = Object.create(null);
  for (const line of lines) {
    const parts = /^([a-zA-Z]+)=(.*)$/.exec(line);
    if (!parts || Object.hasOwn(parsed, parts[1]!)) throw new PreflightError("INVALID_REPORT");
    const key = parts[1]!, value = parts[2]!;
    if (key === "diskKiB") {
      if (value !== "unknown" && (!/^\d{1,15}$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new PreflightError("INVALID_REPORT");
      parsed[key] = value === "unknown" ? null : Number(value);
    } else {
      if (!Object.hasOwn(choices, key) || !(choices[key as keyof typeof choices] as readonly string[]).includes(value)) throw new PreflightError("INVALID_REPORT");
      parsed[key] = value;
    }
  }
  if (!Object.hasOwn(parsed, "diskKiB") || Object.keys(choices).some(key => !Object.hasOwn(parsed, key))) throw new PreflightError("INVALID_REPORT");
  return parsed as HostReport;
}
export function summarizeHost(report: HostReport) {
  const blockers: string[] = [];
  if (report.os !== "Linux" || report.arch === "other") blockers.push("unsupported_platform");
  if (report.bash !== "available") blockers.push("bash_missing");
  if (report.engine !== "local_linux") blockers.push("docker_" + report.engine);
  if (report.compose !== "available") blockers.push("compose_missing");
  if (report.home !== "writable") blockers.push("home_" + report.home);
  if (report.installation !== "absent") blockers.push("installation_" + report.installation);
  if (report.diskKiB === null) blockers.push("disk_unknown");
  else if (report.diskKiB < 2 * 1024 * 1024) blockers.push("disk_low");
  return {
    report, blockers,
    status: blockers.length ? "needs_attention" as const : "prerequisites_observed" as const,
    // Prerequisites are not installation, reachable HTTPS, pairing or model use.
    installed: false as const, executionProbe: "not_run" as const,
  };
}
