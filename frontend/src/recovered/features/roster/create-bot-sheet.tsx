import { botRoleDraftSchema, type BotRoleDraft } from "../../../../../source/shared/bot-role";
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

/** Keep the same picker and motion engine as the packaged New Bot dialog.
 * Stable refs ensure choosing an appearance never remounts the name input. */
export function CreateBotAvatarPicker({ value, language, onChange, disabled = false }: {
  value: AvatarPickerValue; language: UiLanguage; disabled?: boolean; onChange(value: AvatarPickerValue): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const picker = useRef<ReturnType<typeof mountAvatarPicker> | null>(null);
  const current = useRef({ value, language, onChange, disabled });
  current.current = { value, language, onChange, disabled };
  useLayoutEffect(() => {
    if (!host.current) return;
    const instance = mountAvatarPicker(host.current, { ...current.current.value, language: current.current.language, disabled: current.current.disabled, onChange: next => current.current.onChange(next) });
    picker.current = instance;
    return () => { instance.destroy(); if (picker.current === instance) picker.current = null; };
  }, []);
  useLayoutEffect(() => { picker.current?.setValue(value); picker.current?.setLanguage(language); picker.current?.setDisabled(disabled); }, [value.shape, value.color, language, disabled]);
  return <div ref={host} />;
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
  const [appearance, setAppearance] = useState<AvatarPickerValue>({color:"green",shape:"blob"});
  const nameId = useId(), vendorIdForLabel = useId();
  const {color: avatarColor, shape: avatarShape} = appearance;
  const [vendorId, setVendorId] = useState(defaultVendorId ?? vendors[0]?.id ?? "");
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
      <label htmlFor={nameId}>{copy.nameLabel}</label>
      <input
        id={nameId}
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
      <CreateBotAvatarPicker value={appearance} language={language} onChange={next => {if(!busy)setAppearance(next);}} disabled={busy} />
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
