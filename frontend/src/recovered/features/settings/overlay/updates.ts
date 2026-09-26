import type { DesktopUpdateTrack } from "../../../contracts/desktop-bridge";
import { settingsText, type SettingsLanguage } from "./language";
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

export function updateTrackOption(track: UpdateTrack, language: SettingsLanguage = "en"): { value: UpdateTrack; label: string } {
  return { value: track, label: settingsText(language, UPDATE_TRACK_LABELS[track]) };
}

export function disabledUpdateMessage(status: UpdateStatus, language: SettingsLanguage = "en"): string {
  const t = (text: string) => settingsText(language, text);
  if (status.state.type !== "disabled") return "";
  switch (status.state.reason) {
    case "not-packaged":
      return t("Updates are disabled in dev builds");
    case "lab-build":
      return t("BeeBot Lab is a one-off test build and never auto-updates");
    case "unsupported-platform":
      return t("Updates aren't available on this platform");
    case "disabled-by-env":
      return t("Updates are disabled by SAND_DISABLE_UPDATES");
  }
}

export function updateStatusMessage(status: UpdateStatus, language: SettingsLanguage = "en"): UpdateStatusMessage {
  const zh = language === "zh", t = (text: string) => settingsText(language, text);
  const state = status.state;
  switch (state.type) {
    case "disabled":
      return { text: disabledUpdateMessage(status, language), tone: "default" };
    case "checking":
      return { text: t("Checking for updates…"), tone: "default" };
    case "available":
      return { text: zh ? `BeeBot ${state.version} 已可更新` : `BeeBot ${state.version} is available`, tone: "default" };
    case "downloading": {
      const progress = state.progress != null ? ` (${Math.round(state.progress * 100)}%)` : "";
      return { text: zh ? `正在下载 BeeBot ${state.version}…${progress}` : `Downloading BeeBot ${state.version}…${progress}`, tone: "default" };
    }
    case "staging":
      return { text: zh ? `正在准备 BeeBot ${state.version}…` : `Preparing BeeBot ${state.version}…`, tone: "default" };
    case "ready":
      return state.lastCheck?.result === "error"
        ? { text: zh ? `检查更新失败：${state.lastCheck.errorMessage ?? t("unknown error")}。BeeBot ${state.version} 仍已准备就绪，重启即可应用。` : `Update check failed: ${state.lastCheck.errorMessage ?? "unknown error"}. BeeBot ${state.version} is still ready. Restart to apply.`, tone: "error" }
        : { text: zh ? `BeeBot ${state.version} 已准备就绪，重启即可应用。` : `BeeBot ${state.version} is ready. Restart to apply.`, tone: "ready" };
    case "idle":
      return state.lastCheck == null
        ? { text: "", tone: "default" }
        : state.lastCheck.result === "up-to-date"
          ? { text: t("You're up to date"), tone: "default" }
          : { text: zh ? `检查更新失败：${state.lastCheck.errorMessage ?? t("unknown error")}` : `Update check failed: ${state.lastCheck.errorMessage ?? "unknown error"}`, tone: "error" };
  }
}

export type EgressTunnelStatus =
  | { state: "connected"; activeStreams: number; relayedStreams: number }
  | { state: "connecting" }
  | { state: "off" };

export function egressTunnelStatusDescription(status: EgressTunnelStatus, language: SettingsLanguage = "en"): string {
  const zh = language === "zh", t = (text: string) => settingsText(language, text);
  switch (status.state) {
    case "connected":
      return status.activeStreams > 0
        ? zh ? `已连接，正在转发 ${status.activeStreams} 个连接（本次会话共 ${status.relayedStreams} 个）。` : `Connected — routing ${status.activeStreams} connection${status.activeStreams === 1 ? "" : "s"} (${status.relayedStreams} total this session).`
        : zh ? `已连接，本机已准备好转发 BeeBot 电脑的网络请求（本次会话已转发 ${status.relayedStreams} 个）。` : `Connected — this desktop is ready to route web traffic from BeeBot's computer (${status.relayedStreams} routed this session).`;
    case "connecting":
      return t("Connecting to BeeBot's computer…");
    case "off":
      return t("Enabled, but not routing yet — waiting for BeeBot's computer to connect with egress enabled.");
  }
}
