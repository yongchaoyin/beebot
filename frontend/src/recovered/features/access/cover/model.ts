import { CONNECTION_HELP_URL, EXTERNAL_ACCESS_BY_REASON, EXTERNAL_ACCESS_BY_STATE, EXTERNAL_ACCESS_UNKNOWN } from "../../../../../../source/shared/product-access-copy";
import type { CursorAccountDesktopBridge, DesktopBridge } from "../../../contracts/desktop-bridge";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L518
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L523
// Immutable root sha256: ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa

export const ACCESS_BLOCKED_FAILURE_CODE = "sand-access-blocked" as const;
export const ACCESS_ONBOARDING_URL = CONNECTION_HELP_URL;

export type SandAccessState = "granted" | "unavailable" | "paymentRequired" | "unknown";
export type SandAccessBlockReason =
  | "none"
  | "teamPrivacyMode"
  | "teamSetupRequired"
  | "teamAccessRequired"
  | "notOffered"
  | "freeTrialAvailable"
  | "paywallIndividual"
  | "paywallTeamMember"
  | "paywallTeamAdmin"
  | "unspecified";

export interface SandAccess {
  readonly state: SandAccessState | "checking";
  readonly reason: SandAccessBlockReason;
}

export const SAND_ACCESS_CHECKING: SandAccess = { state: "checking", reason: "unspecified" };
export const SAND_ACCESS_UNKNOWN: SandAccess = { state: "unknown", reason: "unspecified" };

const ACCESS_REASONS: ReadonlySet<string> = new Set([
  "none",
  "teamPrivacyMode",
  "teamSetupRequired",
  "teamAccessRequired",
  "notOffered",
  "freeTrialAvailable",
  "paywallIndividual",
  "paywallTeamMember",
  "paywallTeamAdmin",
  "unspecified"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSandAccess(value: unknown): value is SandAccess {
  if (!isRecord(value) || typeof value.state !== "string" || typeof value.reason !== "string") return false;
  return ["checking", "granted", "unavailable", "paymentRequired", "unknown"].includes(value.state)
    && ACCESS_REASONS.has(value.reason);
}

export function projectSandAccess(value: unknown): SandAccess {
  return isSandAccess(value) ? value : SAND_ACCESS_UNKNOWN;
}

export interface AccessCoverCopy {
  readonly title: string;
  readonly body: string;
  readonly action: string | null;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4734556
export function accessNoticeCopy(access: SandAccess): AccessCoverCopy | null {
  if (access.state === "checking" || access.state === "unknown" || access.state === "granted") return null;
  if (Object.hasOwn(EXTERNAL_ACCESS_BY_REASON, access.reason)) return EXTERNAL_ACCESS_BY_REASON[access.reason]!;
  return EXTERNAL_ACCESS_BY_STATE[access.state] ?? null;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5544115
export function accessCoverCopy(access: SandAccess): AccessCoverCopy {
  return accessNoticeCopy(access) ?? EXTERNAL_ACCESS_UNKNOWN;
}

export interface AccessCoverGateInput {
  readonly rosterFailureCode: string | null | undefined;
  readonly hasReachedBox: boolean;
  readonly isShowingRestoredRoster: boolean;
  readonly isComputerRebuildLocked: boolean;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5543963
export function shouldShowAccessCover(input: AccessCoverGateInput): boolean {
  return input.rosterFailureCode === ACCESS_BLOCKED_FAILURE_CODE
    && !input.hasReachedBox
    && !input.isShowingRestoredRoster
    && !input.isComputerRebuildLocked;
}

export async function readFreshSandAccess(
  bridge: Pick<CursorAccountDesktopBridge, "getSandAccessFresh">
): Promise<SandAccess> {
  return projectSandAccess(await bridge.getSandAccessFresh());
}

export function openAccessOnboarding(bridge: Pick<DesktopBridge, "openExternal">): Promise<void> {
  return bridge.openExternal(ACCESS_ONBOARDING_URL);
}
