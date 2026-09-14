// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L499 bytes 2328200,2331500,2332789,2337409,2346511,2346725,2346952,2347189,2347629,2347841,2347970; sha256=ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CursorAuthStatus, DesktopBridge } from "../../../contracts/desktop-bridge";
import { SandMenuContent, SandMenuItem, SandMenuRoot, SandMenuTrigger } from "../../../ui/sand-floating-primitives";
import { accountMenuActions, accountMenuCopy, type UiLanguage } from "./account-menu-copy";

export interface AccountMenuProps {
  account: CursorAuthStatus | null;
  accountLabel: string;
  bridge: Pick<DesktopBridge, "cursorAccount">;
  displayName: string;
  isOpen: boolean;
  language: UiLanguage;
  updatePill?: ReactNode;
  onError(message: string): void;
  onOpenAbout(): void;
  onOpenChange(open: boolean): void;
  onOpenConfigureAi(): void;
  onOpenDocumentation(): void;
  onOpenFeedback(): void;
  onOpenSettings(): void;
  onStatus(status: CursorAuthStatus): void;
}

export function normalizeAccountName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The account-scoped bridge commit used by both native blur and detached-ref cleanup. */
export async function commitAccountName(
  bridge: Pick<DesktopBridge, "cursorAccount">,
  value: string
): Promise<CursorAuthStatus | null> {
  const next = normalizeAccountName(value);
  return next.length === 0 ? null : bridge.cursorAccount.updateName(next);
}

interface AccountNameEditorProps {
  bridge: Pick<DesktopBridge, "cursorAccount">;
  onError(message: string): void;
  onStatus(status: CursorAuthStatus): void;
}

function AccountNameEditor({ bridge, onError, onStatus }: AccountNameEditorProps) {
  const [mode, setMode] = useState<"viewing" | "editing" | "saving">("viewing");
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelOnBlurRef = useRef(false);
  const blurHandledRef = useRef(false);
  const viaKeyboardRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const cancel = useCallback(() => {
    setDraft("");
    setMode("viewing");
  }, []);

  const save = useCallback(async (value: string) => {
    if (normalizeAccountName(value).length === 0) {
      cancel();
      return;
    }
    setMode("saving");
    try {
      const status = await commitAccountName(bridge, value);
      if (!mountedRef.current) return;
      if (status == null) {
        cancel();
        return;
      }
      onStatus(status);
      setDraft("");
      setMode("viewing");
    } catch (reason) {
      if (!mountedRef.current) return;
      setMode("editing");
      onError(`Couldn’t save your name: ${reason instanceof Error ? reason.message : String(reason)}`);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [bridge, cancel, onError, onStatus]);

  const saveRef = useRef(save);
  saveRef.current = save;
  const blurHandlerRef = useRef<(value: string) => void>(() => undefined);
  blurHandlerRef.current = (value) => {
    if (mode === "saving" || blurHandledRef.current) return;
    blurHandledRef.current = true;
    const viaKeyboard = viaKeyboardRef.current;
    viaKeyboardRef.current = false;
    if (cancelOnBlurRef.current) {
      cancelOnBlurRef.current = false;
      void viaKeyboard;
      cancel();
      return;
    }
    void saveRef.current(value);
  };

  const inputRefCallback = useCallback((node: HTMLInputElement | null): (() => void) | void => {
    if (node == null) return;
    inputRef.current = node;
    blurHandledRef.current = false;
    cancelOnBlurRef.current = false;
    viaKeyboardRef.current = false;
    node.focus();
    node.select();
    const nativeBlurHandler = () => blurHandlerRef.current(node.value);
    node.addEventListener("blur", nativeBlurHandler);
    return () => {
      node.removeEventListener("blur", nativeBlurHandler);
      inputRef.current = null;
      if (blurHandledRef.current || node.disabled) return;
      const value = node.value.trim();
      if (value.length > 0 && value !== (node.dataset.initial ?? "")) void saveRef.current(node.value);
    };
  }, []);

  if (mode === "viewing") {
    return <button aria-label="Enter your name" className="sand-agents-sidebar__account-name" onClick={() => setMode("editing")} type="button">Enter your name</button>;
  }

  return <input
    aria-label="Your name"
    autoComplete="off"
    className="sand-agents-sidebar__account-name-input"
    data-initial=""
    disabled={mode === "saving"}
    maxLength={200}
    onBlur={(event) => blurHandlerRef.current(event.currentTarget.value)}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onFocus={() => {
      blurHandledRef.current = false;
      cancelOnBlurRef.current = false;
      viaKeyboardRef.current = false;
    }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        viaKeyboardRef.current = true;
        blurHandlerRef.current(event.currentTarget.value);
        event.currentTarget.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelOnBlurRef.current = true;
        viaKeyboardRef.current = true;
        blurHandlerRef.current(event.currentTarget.value);
        event.currentTarget.blur();
      }
    }}
    placeholder="Enter your name"
    ref={inputRefCallback}
    spellCheck={false}
    value={draft}
  />;
}

export function AccountMenu({
  account,
  accountLabel,
  bridge,
  displayName,
  isOpen,
  language,
  updatePill,
  onError,
  onOpenAbout,
  onOpenChange,
  onOpenConfigureAi,
  onOpenDocumentation,
  onOpenFeedback,
  onOpenSettings,
  onStatus
}: AccountMenuProps) {
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (account?.kind !== "logged-in") {
      setAvatarDataUrl(null);
      return () => { active = false; };
    }
    void bridge.cursorAccount.getAvatar().then((value) => {
      if (active) setAvatarDataUrl(typeof value === "string" && value.length > 0 ? value : null);
    }).catch(() => {
      if (active) setAvatarDataUrl(null);
    });
    return () => { active = false; };
  }, [account?.kind, bridge]);

  const closeAnd = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const copy = accountMenuCopy(language);
  const handlers = {
    settings: onOpenSettings,
    configureAi: onOpenConfigureAi,
    about: onOpenAbout,
    documentation: onOpenDocumentation,
    feedback: onOpenFeedback
  };
  let menuIndex = 0;
  const nextMenuIndex = () => menuIndex++;

  return (
    <div className="sand-agents-sidebar__account sand-agents-sidebar__footer" data-account-menu-open={isOpen || undefined}>
      {updatePill ?? null}
      <SandMenuRoot closeOnSelect={false} offset={4} onOpenChange={onOpenChange} open={isOpen} placement="bottom-start">
        <SandMenuTrigger>
          <button aria-expanded={isOpen} aria-haspopup="menu" aria-label={accountLabel} type="button">
            <span aria-hidden="true">{avatarDataUrl == null ? displayName.slice(0, 1).toUpperCase() : <img alt="" src={avatarDataUrl} />}</span>
            <span><strong>{displayName}</strong>{account?.kind === "logged-in" && account.email != null ? <small>{account.email}</small> : null}</span>
          </button>
        </SandMenuTrigger>
        <SandMenuContent ariaLabel={accountLabel}>
          <div data-component="menu-layout">
          {accountMenuActions().map((action) => (
            <SandMenuItem index={nextMenuIndex()} key={action} onSelect={() => closeAnd(handlers[action])}>
              {copy[action]}
            </SandMenuItem>
          ))}
          </div>
        </SandMenuContent>
      </SandMenuRoot>
      {account?.kind === "logged-in" && account.displayName == null ? <AccountNameEditor key={account.authId ?? account.email ?? "account"} bridge={bridge} onError={onError} onStatus={onStatus} /> : null}
    </div>
  );
}

export default AccountMenu;
