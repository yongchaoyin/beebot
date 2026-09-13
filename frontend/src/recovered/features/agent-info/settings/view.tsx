import { useEffect, useId, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { AgentSettingsController, AgentSettingsProfile } from "./model";
import "./view.css";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2766045 (Agent Settings view)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2768678 (notification copy)

interface EditableFieldProps {
  ariaLabel: string;
  initialValue?: string;
  isMultiline?: boolean;
  isRequired?: boolean;
  placeholder: string;
  onCommit(value: string): void;
}

function EditableField({ ariaLabel, initialValue = "", isMultiline = false, isRequired = false, placeholder, onCommit }: EditableFieldProps) {
  const [draft, setDraft] = useState(initialValue);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(initialValue); }, [focused, initialValue]);
  const commit = () => {
    setFocused(false);
    const normalized = draft.trim();
    if (normalized === initialValue || (normalized.length === 0 && isRequired)) { setDraft(initialValue); return; }
    onCommit(normalized);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(initialValue); setFocused(false); event.currentTarget.blur(); }
    else if (!isMultiline && event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
  };
  const props = {
    "aria-label": ariaLabel,
    onBlur: commit,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.currentTarget.value),
    onFocus: () => setFocused(true),
    onKeyDown,
    placeholder,
    spellCheck: false,
    value: draft
  };
  return isMultiline ? <textarea {...props} /> : <input {...props} type="text" />;
}

export interface AgentSettingsVendorOption {
  readonly id: string;
  readonly label: string;
  readonly modelId?: string;
}

export interface AgentSettingsPanelProps {
  controller: AgentSettingsController;
  vendors?: readonly AgentSettingsVendorOption[];
  language?: "en" | "zh";
}

export function AgentSettingsPanel({ controller, vendors = [], language = "en" }: AgentSettingsPanelProps) {
  const snapshot = useControllerSnapshot(controller);
  const { agent, pending, error } = snapshot;
  const notificationsLabelId = useId();
  const vendorLabel = language === "zh" ? "这个 Bot 使用的 API" : "API for this Bot";
  const commit = (field: "name" | "title" | "description" | "inferenceVendorId", value: string) => {
    const profile: AgentSettingsProfile = { ...profileFor(agent), [field]: value };
    void controller.updateProfile(profile).catch(() => {});
  };
  return <section aria-label="Agent settings" className="sand-agent-settings" data-agent-id={agent.id} data-pending={pending ?? undefined}>
    <div className="sand-info-pane__section-content">
      <div className="sand-info-pane__section-heading">Name</div><EditableField ariaLabel="Agent name" initialValue={agent.name} isRequired onCommit={(value) => commit("name", value)} placeholder="Bob" />
      {!agent.isGroup && agent.title !== undefined ? <><div className="sand-info-pane__section-heading">Title</div><EditableField ariaLabel="Agent title" initialValue={agent.title} onCommit={(value) => commit("title", value)} placeholder="Describe what your agent does" /></> : null}
      <div className="sand-info-pane__section-heading">Description</div><EditableField ariaLabel="Agent description" initialValue={agent.description} isMultiline onCommit={(value) => commit("description", value)} placeholder="What this agent is for" />
      {agent.isGroup || vendors.length === 0 ? null : <>
        <div className="sand-info-pane__section-heading">{vendorLabel}</div>
        <select aria-label={vendorLabel} disabled={pending != null} onChange={(event) => commit("inferenceVendorId", event.currentTarget.value)} value={typeof agent.inferenceVendorId === "string" && agent.inferenceVendorId.length > 0 ? agent.inferenceVendorId : vendors[0]?.id ?? ""}>
          {vendors.map((item) => <option key={item.id} value={item.id}>{item.modelId ? `${item.label} · ${item.modelId}` : item.label}</option>)}
        </select>
      </>}
    </div>
    {agent.isGroup ? null : <div className="sand-agent-settings__card">
      <div className="sand-agent-settings__row">
        <span className="sand-agent-settings__text"><span id={notificationsLabelId}>Notifications</span><small>Get notified when this agent finishes or needs input</small></span>
        <span className="sand-agent-settings__control"><button aria-checked={agent.notifyOnUpdatesEnabled} aria-labelledby={notificationsLabelId} disabled={pending != null} onClick={() => void controller.setNotifications(!agent.notifyOnUpdatesEnabled).catch(() => {})} role="switch" type="button">{agent.notifyOnUpdatesEnabled ? "On" : "Off"}</button></span>
      </div>
    </div>}
    {error == null ? null : <div aria-live="polite" role="status">{error instanceof Error ? error.message : String(error)}</div>}
  </section>;
}

function profileFor(agent: AgentSettingsPanelProps["controller"] extends { getSnapshot(): { agent: infer T } } ? T : never): AgentSettingsProfile {
  const candidate = agent as { name: string; title?: string; description: string; inferenceVendorId?: string };
  return { name: candidate.name, ...(candidate.title === undefined ? {} : { title: candidate.title }), description: candidate.description, ...(candidate.inferenceVendorId === undefined ? {} : { inferenceVendorId: candidate.inferenceVendorId }) };
}

function useControllerSnapshot(controller: AgentSettingsController) {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot);
  useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller]);
  return snapshot;
}
