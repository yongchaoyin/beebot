import { botRoleDraftSchema, type BotRoleDraft } from "../../../../../source/shared/bot-role";
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
  readonly role: BotRoleDraft;
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
  onCreate(draft: CreateBotDraft): void | Promise<void>;
}

export function CreateBotSheet({ language, vendors = [], defaultVendorId, onCancel, onCreate }: CreateBotSheetProps) {
  const copy = createBotCopy(language);
  const [name, setName] = useState("");
  const [role, setRole] = useState<BotRoleDraft>(() => ({primaryJob:"",responsibilities:[],outOfScope:[],deliverables:[],workingStyle:""}));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const jobLabel = language === "zh" ? "这位同事主要负责什么？" : "What is this colleague's primary job?";
  const details = language === "zh" ? "细化职责与边界（可选）" : "Refine scope and boundaries (optional)";
  const roleFields = [["responsibilities","负责范围","Responsibilities"],["outOfScope","不负责的工作","Outside this role"],["deliverables","通常交付什么","Expected deliverables"],["workingStyle","协作约定","Working agreements"]] as const;
  const [scopeText,setScopeText] = useState({responsibilities:"",outOfScope:"",deliverables:"",workingStyle:""});
  const submit = async () => {
    if(busy)return;
    const parsed=botRoleDraftSchema.safeParse({...role,...Object.fromEntries(Object.entries(scopeText).map(([key,value])=>[key,key==="workingStyle"?value:value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)]))});
    if(!parsed.success){setError(language==="zh"?"请填写主要职责。详细范围最多 12 行，每行 600 字；协作约定最多 1200 字。":"Enter a primary job. Scope allows 12 lines of 600 characters; working agreements allow 1200 characters.");return;}
    setBusy(true);setError("");
    try{await onCreate({name:name.trim()||copy.namePlaceholder,avatarColor,avatarShape,inferenceVendorId:vendorId,role:parsed.data});}
    catch{setError(language==="zh"?"创建未完成，输入已保留，请核对后重试。":"Creation did not complete. Your input is preserved; check and retry.");}
    finally{setBusy(false);}
  };
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
        <button aria-label={copy.close} disabled={busy} onClick={onCancel} type="button">×</button>
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
      <div className="sand-create-bot-role">
        <label htmlFor="create-primary-job">{jobLabel}</label>
        <input id="create-primary-job" aria-label={jobLabel} aria-required="true" maxLength={240} disabled={busy} value={role.primaryJob} onChange={event=>setRole({...role,primaryJob:event.currentTarget.value})}/>
        <p>{language==="zh"?"一个主要岗位；职责内独立负责，不因此获得工具权限。":"One primary job, owned end to end. This does not grant tool permissions."}</p>
        <details><summary>{details}</summary>{roleFields.map(([key,cn,en])=><label key={key}>{language==="zh"?cn:en}<textarea aria-label={language==="zh"?cn:en} disabled={busy} value={scopeText[key]} maxLength={key==="workingStyle"?1200:7200} onChange={event=>setScopeText({...scopeText,[key]:event.currentTarget.value})}/></label>)}</details>
      </div>
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
      <p role="status">{error}</p>
      <SandButton disabled={busy} onClick={() => void submit()} size="md">
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
