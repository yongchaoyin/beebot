import { EXTERNAL_SERVICE_MESSAGES } from "../../../../../source/shared/product-access-copy";
import { useEffect, useRef, useState } from "react";
import type { CursorAuthStatus, DesktopBridge } from "../../contracts/desktop-bridge";
import { SandButton } from "../../ui/sand-kit-primitives";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5335889 (privacyBlock snapshot consumer)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5335962 (external privacy settings URL)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5337901 (modal lifecycle)

export const PRIVACY_SETTINGS_URL = "https://cursor.com/dashboard/settings?openPrivacy=true";

export const PRIVACY_BLOCK_LABELS = {
  title: "Update Privacy Mode",
  description: EXTERNAL_SERVICE_MESSAGES.privacyBlocked,
  support: "This setting is shared with Cursor. Leaving Legacy can’t be undone.",
  signOut: "Sign out",
  openSettings: "Open Privacy Settings"
} as const;

export function isRosterPrivacyBlockFailure(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.code === "CLOUD_AGENT_STORAGE_DISABLED" || record.transportKind === "no_storage";
}

export interface PrivacyBlockedDialogProps {
  bridge: Pick<DesktopBridge, "cursorAccount" | "openExternal">;
  onStatus(status: CursorAuthStatus): void;
}

export function PrivacyBlockedDialog({ bridge, onStatus }: PrivacyBlockedDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const openSettingsRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openSettingsRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (dialogRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      onStatus(await bridge.cursorAccount.logout());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={PRIVACY_BLOCK_LABELS.title} aria-modal="true" className="sand-privacy-blocked-dialog" ref={dialogRef} role="alertdialog">
      <header>
        <h2>{PRIVACY_BLOCK_LABELS.title}</h2>
        <p>{PRIVACY_BLOCK_LABELS.description}</p>
      </header>
      <p>{PRIVACY_BLOCK_LABELS.support}</p>
      <footer>
        <SandButton disabled={busy} onClick={() => void signOut()} sentiment="danger" size="sm">{PRIVACY_BLOCK_LABELS.signOut}</SandButton>
        <SandButton disabled={busy} onClick={() => void bridge.openExternal(PRIVACY_SETTINGS_URL)} ref={openSettingsRef} size="sm" variant="secondary">
          {PRIVACY_BLOCK_LABELS.openSettings}
        </SandButton>
      </footer>
    </section>
  );
}

export default PrivacyBlockedDialog;
