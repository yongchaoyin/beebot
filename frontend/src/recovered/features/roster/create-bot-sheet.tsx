import { useEffect, useMemo, useState } from "react";
import { AVATAR_COLORS, AVATAR_SHAPES } from "../agent-info/avatar-editor/model";
import { OnboardingCharacter } from "../onboarding/signed-in/character";
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

export function CreateBotSheet({ language, vendors = [], defaultVendorId, onCancel, onCreate }: CreateBotSheetProps) {
  const copy = createBotCopy(language);
  const [name, setName] = useState("");
  const [avatarColor, setAvatarColor] = useState("green");
  const [avatarShape, setAvatarShape] = useState("blob");
  const [vendorId, setVendorId] = useState(defaultVendorId ?? vendors[0]?.id ?? "");
  const hex = useMemo(() => AVATAR_COLORS.find((item) => item.id === avatarColor)?.value ?? "#00C972", [avatarColor]);
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
      <div className="sand-create-bot-sheet__preview">
        <OnboardingCharacter color={avatarColor} paused shape={avatarShape} sizePx={120} state="idle" />
      </div>
      <label>{copy.nameLabel}</label>
      <input
        aria-label={copy.nameLabel}
        onChange={(event) => setName(event.currentTarget.value)}
        placeholder={copy.namePlaceholder}
        value={name}
      />
      <div aria-label="color" className="sand-create-bot-sheet__swatches">
        {AVATAR_COLORS.map((item) => (
          <button
            aria-pressed={item.id === avatarColor}
            key={item.id}
            onClick={() => setAvatarColor(item.id)}
            style={{ background: item.value }}
            title={item.label}
            type="button"
          />
        ))}
      </div>
      <div aria-label="shape" className="sand-create-bot-sheet__shapes">
        {AVATAR_SHAPES.map((item) => (
          <button aria-pressed={item === avatarShape} key={item} onClick={() => setAvatarShape(item)} type="button">
            <OnboardingCharacter color={item === avatarShape ? avatarColor : "gray"} paused shape={item} sizePx={32} state="idle" />
          </button>
        ))}
      </div>
      {vendors.length > 0 ? (
        <>
          <label>{copy.vendor}</label>
          <select aria-label={copy.vendor} onChange={(event) => setVendorId(event.currentTarget.value)} value={vendorId}>
            {vendors.map((item) => (
              <option key={item.id} value={item.id}>{item.modelId ? `${item.label} · ${item.modelId}` : item.label}</option>
            ))}
          </select>
        </>
      ) : null}
      <SandButton onClick={() => onCreate({ name: name.trim() || copy.namePlaceholder, avatarColor, avatarShape, inferenceVendorId: vendorId })} size="md">
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
