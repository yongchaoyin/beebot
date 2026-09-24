import type { CursorAccountDesktopBridge, DesktopBridge } from "../../../contracts/desktop-bridge";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L518
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L523
// Immutable root sha256: ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa

export const ACCESS_BLOCKED_FAILURE_CODE = "sand-access-blocked" as const;
export const ACCESS_ONBOARDING_URL = "https://cursor.com/bot/onboarding" as const;

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
  if (access.reason === "teamPrivacyMode") {
    return {
      title: "Your team's privacy mode blocks BeeBot",
      body: "BeeBot can't run under Privacy Mode (Legacy). Ask a team admin to move the team off it.",
      action: "See Details"
    };
  }
  if (access.reason === "teamSetupRequired") {
    return {
      title: "Your team hasn't set up BeeBot yet",
      body: "A team admin has to finish BeeBot setup before members can send messages.",
      action: "See Details"
    };
  }
  if (access.reason === "teamAccessRequired") {
    return {
      title: "Your team hasn't given this account BeeBot",
      body: "Your team's settings withhold BeeBot. A team admin can grant it.",
      action: "Request Access"
    };
  }
  if (access.reason === "notOffered") {
    return { title: "BeeBot is not available for this account", body: "There's nothing to set up or purchase here.", action: null };
  }
  if (access.reason === "freeTrialAvailable") {
    return { title: "Start a BeeBot trial to send messages", body: "This account can try BeeBot now.", action: "Start Trial" };
  }
  if (access.reason === "paywallIndividual") {
    return { title: "BeeBot needs an Ultra plan", body: "Upgrade to Ultra to send messages with BeeBot.", action: "Get Ultra" };
  }
  if (access.reason === "paywallTeamMember") {
    return { title: "BeeBot needs a Premium seat", body: "Ask a team admin to move this account to a Premium seat.", action: "Request Access" };
  }
  if (access.reason === "paywallTeamAdmin") {
    return { title: "BeeBot needs a Premium seat", body: "Move this account to a Premium seat to send messages.", action: "Manage Seats" };
  }
  if (access.state === "unavailable") {
    return { title: "BeeBot is not available for this account", body: "Sending is off until this account is given access. Check what it needs on the web.", action: "Check Access" };
  }
  if (access.state === "paymentRequired") {
    return { title: "BeeBot is not included in this plan", body: "Sending is off until this account has BeeBot. Check the options on the web.", action: "Check Access" };
  }
  return null;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5544115
export function accessCoverCopy(access: SandAccess): AccessCoverCopy {
  return accessNoticeCopy(access) ?? {
    title: "BeeBot isn’t available on this account yet",
    body: "Check what this account needs on the web.",
    action: "Check Access"
  };
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
