import { useSettingsText } from "./language";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { SettingsNoticeEvent as SettingsNoticeEventContract } from "../../../contracts/surface-notice";
import { SandIcon, SandIconButton } from "../../../ui/sand-kit-primitives";

export type { SettingsNoticeEventContract as SettingsNoticeEvent };

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#sha256=ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa#byteOffset=5464180-5466718
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#sha256=80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5#byteOffset=6863047-6866267

export type SettingsNoticeKind = "success" | "error";

export interface SettingsNotice {
  readonly kind: SettingsNoticeKind;
  readonly text: string;
}

/** Preserve the shipped notice boundary while adapting the typed surface event. */
export function settingsNoticeFromEvent(event: Pick<SettingsNoticeEventContract, "kind" | "message">): SettingsNotice {
  return { kind: event.kind, text: event.message };
}

export interface SettingsNoticeTimer {
  dispose(): void;
}

export interface SettingsNoticeScheduler {
  schedule(callback: () => void, delayMs: number): SettingsNoticeTimer;
}

const SUCCESS_DISMISS_MS = 3_500;
const ERROR_DISMISS_MS = 6_000;

const BROWSER_SCHEDULER: SettingsNoticeScheduler = {
  schedule(callback, delayMs) {
    const handle = globalThis.setTimeout(callback, delayMs);
    return { dispose: () => globalThis.clearTimeout(handle) };
  }
};

const SUCCESS_CLASS = "sand-9f619 sand-10l6tqk sand-k6ci0l sand-191j7n5 sand-1c42kn3 sand-78zum5 sand-6s0dn4 sand-167g77z sand-96k8nx sand-nuq7ks sand-dvlbce sand-f18ygs sand-mkeg23 sand-1y0btm7 sand-hpnuu7 sand-1ct8sxb sand-bovzr6 sand-1tjthvr sand-2ufsx4 sand-98zg7y";
const ERROR_CLASS = "sand-9f619 sand-10l6tqk sand-k6ci0l sand-191j7n5 sand-1c42kn3 sand-78zum5 sand-6s0dn4 sand-167g77z sand-96k8nx sand-nuq7ks sand-dvlbce sand-f18ygs sand-mkeg23 sand-1y0btm7 sand-hpnuu7 sand-1ct8sxb sand-bovzr6 sand-jyw3bf sand-treaks sand-pmgbkh";
const TEXT_CLASS = "sand-1iyjqo2 sand-euugli";
const DISMISS_CLASS = "sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-1xp8n7a sand-mix8c7 sand-1717udv sand-c342km sand-ng3xce sand-1sxf85j sand-1heor9g sand-1ypdohk sand-1ks1olk sand-1o7uuvo sand-jbqb8w sand-af7s7e";

export interface SettingsNoticeExpiry {
  get(): boolean;
  subscribe(listener: () => void): () => void;
  setNotice(notice: SettingsNotice | null): void;
  reset(): void;
  dispose(): void;
}

export function createSettingsNoticeExpiry(scheduler: SettingsNoticeScheduler = BROWSER_SCHEDULER): SettingsNoticeExpiry {
  let expired = false;
  let timer: SettingsNoticeTimer | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const clear = () => {
    timer?.dispose();
    timer = null;
  };
  const setNotice = (notice: SettingsNotice | null) => {
    if (disposed) return;
    clear();
    expired = false;
    if (notice != null) {
      timer = scheduler.schedule(() => {
        timer = null;
        if (disposed) return;
        expired = true;
        notify();
      }, notice.kind === "error" ? ERROR_DISMISS_MS : SUCCESS_DISMISS_MS);
    }
    notify();
  };
  return {
    get: () => expired,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setNotice,
    reset: () => setNotice(null),
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      listeners.clear();
    }
  };
}

function NoticeIcon({ name }: { readonly name: "check" | "close" }) {
  return <SandIcon name={name} size="sm" />;
}

export interface SettingsNoticeViewProps {
  readonly notice: SettingsNotice | null;
  readonly onDismiss: () => void;
  readonly scheduler?: SettingsNoticeScheduler;
}

export function SettingsNoticeView({ notice, onDismiss, scheduler = BROWSER_SCHEDULER }: SettingsNoticeViewProps) {
  const t = useSettingsText();
  const expiry = useMemo(() => createSettingsNoticeExpiry(scheduler), [scheduler]);
  useEffect(() => () => expiry.dispose(), [expiry]);
  useEffect(() => { expiry.setNotice(notice); }, [expiry, notice]);
  const expired = useSyncExternalStore(expiry.subscribe, expiry.get, expiry.get);
  if (notice == null || expired) return null;
  const isError = notice.kind === "error";
  return <div aria-live="polite" className={`${isError ? ERROR_CLASS : SUCCESS_CLASS} sand-settings-toast`} data-kind={notice.kind}>
    <NoticeIcon name={isError ? "close" : "check"} />
    <span className={TEXT_CLASS}>{notice.text}</span>
    <SandIconButton aria-label={t("Dismiss")} className={DISMISS_CLASS} icon="close" label={t("Dismiss")} onClick={onDismiss} size="sm" />
  </div>;
}

export const SETTINGS_NOTICE_DISMISS_MS = {
  success: SUCCESS_DISMISS_MS,
  error: ERROR_DISMISS_MS
} as const;

export const SETTINGS_NOTICE_CLASSES = {
  success: SUCCESS_CLASS,
  error: ERROR_CLASS,
  text: TEXT_CLASS,
  dismiss: DISMISS_CLASS
} as const;
