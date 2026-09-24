import type { DesktopUpdateTrack } from "../../../contracts/desktop-bridge";
// @evidence src/app/dist/renderer/assets/index-BlqerJhg.js#L1

export type UpdateTrack = DesktopUpdateTrack;
export type UpdateTone = "default" | "error" | "ready";

export const UPDATE_TRACK_LABELS: Readonly<Record<UpdateTrack, string>> = {
  stable: "Stable",
  nightly: "Nightly",
  dogfood: "Dogfood"
};

/** Preserved verbatim as configuration evidence from the public 0.18 renderer. */
export const INTERNAL_RELEASE_TRACK_CONFIG_URL =
  "https://console.statsig.com/5oWaLs1Xr8U2ei9Hq2R45w/dynamic_configs/sand_internal_release_track_override";

export type DisabledUpdateReason =
  | "not-packaged"
  | "lab-build"
  | "unsupported-platform"
  | "disabled-by-env";

export type LastUpdateCheck =
  | { result: "up-to-date" }
  | { result: "error"; errorMessage?: string | null };

export type UpdateState =
  | { type: "disabled"; reason: DisabledUpdateReason }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "downloading"; version: string; progress?: number | null }
  | { type: "staging"; version: string }
  | { type: "ready"; version: string; lastCheck?: LastUpdateCheck | null }
  | { type: "idle"; lastCheck?: LastUpdateCheck | null };

export interface UpdateStatus {
  state: UpdateState;
  currentTrack: UpdateTrack;
  currentVersion: string;
  isTrackManagedByPolicy?: boolean;
  autoUpdateWhenIdleOptIn?: boolean;
  autoUpdateWhenIdleGateEnabled?: boolean;
}

export interface UpdateStatusMessage {
  text: string;
  tone: UpdateTone;
}

export function updateTrackOption(track: UpdateTrack): { value: UpdateTrack; label: string } {
  return { value: track, label: UPDATE_TRACK_LABELS[track] };
}

export function disabledUpdateMessage(status: UpdateStatus): string {
  if (status.state.type !== "disabled") return "";
  switch (status.state.reason) {
    case "not-packaged":
      return "Updates are disabled in dev builds";
    case "lab-build":
      return "BeeBot Lab is a one-off test build and never auto-updates";
    case "unsupported-platform":
      return "Updates aren't available on this platform";
    case "disabled-by-env":
      return "Updates are disabled by SAND_DISABLE_UPDATES";
  }
}

export function updateStatusMessage(status: UpdateStatus): UpdateStatusMessage {
  const state = status.state;
  switch (state.type) {
    case "disabled":
      return { text: disabledUpdateMessage(status), tone: "default" };
    case "checking":
      return { text: "Checking for updates…", tone: "default" };
    case "available":
      return { text: `BeeBot ${state.version} is available`, tone: "default" };
    case "downloading": {
      const progress = state.progress != null ? ` (${Math.round(state.progress * 100)}%)` : "";
      return { text: `Downloading BeeBot ${state.version}…${progress}`, tone: "default" };
    }
    case "staging":
      return { text: `Preparing BeeBot ${state.version}…`, tone: "default" };
    case "ready":
      return state.lastCheck?.result === "error"
        ? { text: `Update check failed: ${state.lastCheck.errorMessage ?? "unknown error"}. BeeBot ${state.version} is still ready. Restart to apply.`, tone: "error" }
        : { text: `BeeBot ${state.version} is ready. Restart to apply.`, tone: "ready" };
    case "idle":
      return state.lastCheck == null
        ? { text: "", tone: "default" }
        : state.lastCheck.result === "up-to-date"
          ? { text: "You're up to date", tone: "default" }
          : { text: `Update check failed: ${state.lastCheck.errorMessage ?? "unknown error"}`, tone: "error" };
  }
}

export type EgressTunnelStatus =
  | { state: "connected"; activeStreams: number; relayedStreams: number }
  | { state: "connecting" }
  | { state: "off" };

export function egressTunnelStatusDescription(status: EgressTunnelStatus): string {
  switch (status.state) {
    case "connected":
      return status.activeStreams > 0
        ? `Connected — routing ${status.activeStreams} connection${status.activeStreams === 1 ? "" : "s"} (${status.relayedStreams} total this session).`
        : `Connected — this desktop is ready to route web traffic from BeeBot's computer (${status.relayedStreams} routed this session).`;
    case "connecting":
      return "Connecting to BeeBot's computer…";
    case "off":
      return "Enabled, but not routing yet — waiting for BeeBot's computer to connect with egress enabled.";
  }
}
