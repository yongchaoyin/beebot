import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { mountAvatarPicker, type AvatarPickerValue } from "../../../presence/avatar-picker";
import { SandButton } from "../../ui/sand-kit-primitives";

export type UiLanguage = "en" | "zh";

function createBotCopy(language: UiLanguage) {
  return language === "zh"
    ? { title: "新建 Bot", namePlaceholder: "New Bot", create: "开始使用", close: "关闭", nameLabel: "名称", vendor: "使用的 API" }
    : { title: "New Bot", namePlaceholder: "New Bot", create: "Get started", close: "Close", nameLabel: "Name", vendor: "API" };
}

export function parseUiLanguage(value: unknown): UiLanguage {
  return value === "zh" || value === "zh-CN" || value === "zh-Hans" ? "zh" : "en";
}

export interface CreateBotDraft {
  readonly name: string;
  readonly avatarColor: string;
  readonly avatarShape: string;
  readonly inferenceVendorId?: string;
}

export interface CreateBotVendorOption {
  readonly id: string;
  readonly label: string;
  readonly modelId?: string;
}

export interface CreateBotSheetProps {
  language: UiLanguage;
  vendors?: readonly CreateBotVendorOption[];
  defaultVendorId?: string;
  onCancel(): void;
  onCreate(draft: CreateBotDraft): void;
}

/** Keep the same picker and motion engine as the packaged New Bot dialog.
 * Stable refs ensure choosing an appearance never remounts the name input. */
export function CreateBotAvatarPicker({ value, language, onChange }: {
  value: AvatarPickerValue; language: UiLanguage; onChange(value: AvatarPickerValue): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const picker = useRef<ReturnType<typeof mountAvatarPicker> | null>(null);
  const current = useRef({ value, language, onChange });
  current.current = { value, language, onChange };
  useLayoutEffect(() => {
    if (!host.current) return;
    const instance = mountAvatarPicker(host.current, { ...current.current.value, language: current.current.language, onChange: next => current.current.onChange(next) });
    picker.current = instance;
    return () => { instance.destroy(); if (picker.current === instance) picker.current = null; };
  }, []);
  useLayoutEffect(() => { picker.current?.setValue(value); picker.current?.setLanguage(language); }, [value.shape, value.color, language]);
  return <div ref={host} />;
}

export function CreateBotSheet({ language, vendors = [], defaultVendorId, onCancel, onCreate }: CreateBotSheetProps) {
  const copy = createBotCopy(language);
  const [name, setName] = useState("");
  const [appearance, setAppearance] = useState<AvatarPickerValue>({ color: "green", shape: "blob" });
  const nameId = useId(), vendorIdForLabel = useId();
  const [vendorId, setVendorId] = useState(defaultVendorId ?? vendors[0]?.id ?? "");
  useEffect(() => {
    if (vendorId.length > 0) return;
    const next = defaultVendorId ?? vendors[0]?.id ?? "";
    if (next.length > 0) setVendorId(next);
  }, [defaultVendorId, vendorId, vendors]);
  return (
    <div className="sand-create-bot-sheet" role="dialog" aria-label={copy.title}>
      <header>
        <button aria-label={copy.close} onClick={onCancel} type="button">×</button>
        <h1>{copy.title}</h1>
      </header>
      <label htmlFor={nameId}>{copy.nameLabel}</label>
      <input
        id={nameId}
        aria-label={copy.nameLabel}
        onChange={(event) => setName(event.currentTarget.value)}
        placeholder={copy.namePlaceholder}
        value={name}
      />
      <CreateBotAvatarPicker value={appearance} language={language} onChange={setAppearance} />
      {vendors.length > 0 ? (
        <>
          <label htmlFor={vendorIdForLabel}>{copy.vendor}</label>
          <select id={vendorIdForLabel} aria-label={copy.vendor} onChange={(event) => setVendorId(event.currentTarget.value)} value={vendorId}>
            {vendors.map((item) => (
              <option key={item.id} value={item.id}>{item.modelId ? `${item.label} · ${item.modelId}` : item.label}</option>
            ))}
          </select>
        </>
      ) : null}
      <SandButton onClick={() => onCreate({ name: name.trim() || copy.namePlaceholder, avatarColor: appearance.color, avatarShape: appearance.shape, inferenceVendorId: vendorId })} size="md">
        {copy.create}
      </SandButton>
    </div>
  );
}

export function useUiLanguage(read: () => Promise<{ language?: string } | null>): UiLanguage {
  const [language, setLanguage] = useState<UiLanguage>("en");
  useEffect(() => {
    let active = true;
    void read().then((value) => { if (active) setLanguage(parseUiLanguage(value?.language)); }).catch(() => undefined);
    return () => { active = false; };
  }, [read]);
  return language;
}
