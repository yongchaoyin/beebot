import { createHash, randomUUID } from "node:crypto";
import { parseTarget, summarizeHost, type HostReport, type SshTarget } from "./preflight.js";
import { packagedNodeReleases, type ReleaseCatalog } from "./release-catalog.js";

export class InstallPlanError extends Error {
  constructor(readonly code: "INVALID_INSTALL_OPTIONS" | "PREFLIGHT_REQUIRED" | "EXPIRED_PREFLIGHT" | "INVALID_CATALOG") { super(code); this.name = "InstallPlanError"; }
}
export type InstallationOptions = Readonly<{ domain: string; name: string }>;
export type TrustedInspection = Readonly<{ target: SshTarget; fingerprint: string; checkedAt: number; report: HostReport }>;
export function parseInstallationOptions(value: unknown): InstallationOptions {
  const bad = (): never => { throw new InstallPlanError("INVALID_INSTALL_OPTIONS"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  const o = value as Record<string, unknown>;
  if (Object.keys(o).length !== 2 || !Object.hasOwn(o, "domain") || !Object.hasOwn(o, "name")) return bad();
  const { domain, name } = o;
  if (typeof domain !== "string" || domain.length > 253 || domain !== domain.trim() || !domain.includes(".") || /^[0-9.]+$/.test(domain) ||
      !domain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      typeof name !== "string" || !name.length || name.length > 100 || name !== name.trim() || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name)) return bad();
  return Object.freeze({ domain, name });
}

/** A preview is not execution consent. Only main-process observations may enter
 * here. No SSH, DNS, image pull, filesystem write, credentials or task mutation. */
export function previewInstallation(inspection: TrustedInspection | undefined, input: unknown, now = Date.now(), catalog: ReleaseCatalog = packagedNodeReleases) {
  if (!inspection) throw new InstallPlanError("PREFLIGHT_REQUIRED");
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(inspection.checkedAt) || inspection.checkedAt > now || now - inspection.checkedAt >= 300000) throw new InstallPlanError("EXPIRED_PREFLIGHT");
  const target = parseTarget(inspection.target), options = parseInstallationOptions(input);
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(inspection.fingerprint)) throw new InstallPlanError("PREFLIGHT_REQUIRED");
  const platform = inspection.report.os !== "Linux" ? null : inspection.report.arch === "x86_64" ? "linux/amd64" : ["aarch64", "arm64"].includes(inspection.report.arch) ? "linux/arm64" : null;
  const releases = catalog(now); // Production: only signed, client-packaged offers; never renderer-supplied images.
  const seen = new Set<number>();
  for (const release of releases) {
    if (seen.has(release.manifest.sequence)) throw new InstallPlanError("INVALID_CATALOG");
    seen.add(release.manifest.sequence);
  }
  const selected = [...releases].filter(r => r.manifest.issuedAt <= now && now < r.manifest.expiresAt && platform && r.manifest.images[platform])
    .sort((a, b) => b.manifest.sequence - a.manifest.sequence)[0];
  const blockers = [...summarizeHost(inspection.report).blockers];
  if (!releases.length) blockers.push("release_unavailable");
  else if (!selected) blockers.push("release_platform_unavailable");
  if (selected && inspection.report.diskKiB !== null && inspection.report.diskKiB < selected.manifest.minimumDiskKiB && !blockers.includes("disk_low")) blockers.push("release_disk_low");
  // Installation/enrollment must be wired on the accepted security baseline.
  // Never let a green plan imply an apply endpoint or bypass trusted-device auth.
  blockers.push("execution_not_enabled");
  const spec = {
    schemaVersion: 1, target, fingerprint: inspection.fingerprint, checkedAt: inspection.checkedAt,
    options, platform, instance: "server", directory: "$HOME/.local/share/beebot/server",
    origin: `https://${options.domain}`, transport: "https" as const,
    release: selected ? { version: selected.manifest.version, sequence: selected.manifest.sequence, manifestDigest: selected.digest,
      publisher: selected.publisher, image: selected.manifest.images[platform!]!, proxyImage: selected.manifest.proxyImage,
      minimumDiskKiB: selected.manifest.minimumDiskKiB, securityProfile: selected.manifest.securityProfile } : null,
    expiresAt: Math.min(inspection.checkedAt + 300000, selected?.manifest.expiresAt ?? Infinity),
    changes: ["private_installation_files", "isolated_volumes_networks", "node_and_proxy_services", "inbound_80_443"],
    preserved: ["existing_installations", "node_identity", "firewall", "os_users", "docker_configuration", "model_credentials", "bot_work"],
    prerequisitesToVerify: ["dns", "inbound_reachability", "registry_model_egress", "image_availability", "client_tls", "device_enrollment", "model_execution"],
    blockers,
  };
  return { ...spec, id: randomUUID(), specificationDigest: createHash("sha256").update(JSON.stringify(spec)).digest("hex"),
    status: "review_only" as const, canInstall: false as const, installed: false as const, executionProbe: "not_run" as const };
}
