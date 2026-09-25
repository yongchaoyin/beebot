import { AVATAR_SHAPES as SHAPE_CHOICES, characterVariant } from "../../../../presence/avatar-art";
import { PresenceMotionSetting, PresenceAvatarPreview } from "../../../../presence/components";
import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, PointerEvent, RefObject } from "react";
import { OnboardingCharacter, resolvePersonaColor, resolvePersonaShape } from "../../onboarding/signed-in/character";
import type { AvatarCharacter } from "./model";
import { AVATAR_COLORS } from "./model";
import type { AvatarEditorController, AvatarEditorSnapshot } from "./controller";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2750022 (c3n AvatarEditor view; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=3497738 (c3n AvatarEditor view; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)

export interface AvatarEditorViewProps {
  readonly controller: AvatarEditorController;
  readonly onClose: () => void;
  readonly triggerRef?: RefObject<HTMLElement | null>;
  readonly agentIsGroup?: boolean;
}

function useController(controller: AvatarEditorController): AvatarEditorSnapshot {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot);
  useEffect(() => {
    setSnapshot(controller.getSnapshot());
    controller.setOpen(true);
    return controller.subscribe(() => setSnapshot(controller.getSnapshot()));
  }, [controller]);
  useEffect(() => () => { controller.setOpen(false); }, [controller]);
  return snapshot;
}

function CharacterChooser({ snapshot, controller }: { readonly snapshot: AvatarEditorSnapshot; readonly controller: AvatarEditorController }) {
  const character: AvatarCharacter = snapshot.stagedCharacter ?? snapshot.persistedCharacter;
  const resolvedColor = resolvePersonaColor(snapshot.agentId, character.avatarColor);
  const resolvedShape = resolvePersonaShape(snapshot.agentId, character.avatarShape);
  const disabled = snapshot.isSaving || snapshot.isCommitting;
  return <div className="sand-agent-character sand-78zum5 sand-dt5ytf sand-1oot3zn">
    <PresenceAvatarPreview color={resolvedColor} shape={resolvedShape} />
    <div aria-label="Character shape" className="sand-78zum5 sand-6s0dn4 sand-ehausa">
      {SHAPE_CHOICES.map((candidate) => <button aria-label={`${candidate} character shape`} aria-pressed={characterVariant(resolvedShape) === characterVariant(candidate)} className="sand-agent-character__shape" disabled={disabled} key={candidate} onClick={() => void controller.stageCharacter({ avatarShape: candidate })} title={candidate} type="button">
        <OnboardingCharacter color={resolvedColor} shape={candidate} sizePx={36} state="idle" paused sourceId={`${snapshot.agentId}-${candidate}`} />
      </button>)}
    </div>
    <div aria-label="Character color" className="sand-78zum5 sand-6s0dn4 sand-ehausa">
      {AVATAR_COLORS.map((candidate) => <button aria-label={`${candidate.label} character color`} aria-pressed={resolvedColor === candidate.id} disabled={disabled} key={candidate.id} onClick={() => void controller.stageCharacter({ avatarColor: candidate.id })} title={candidate.label} type="button">
        <span aria-hidden="true" style={{ backgroundColor: candidate.value, display: "block", height: 24, width: 24 }} />
      </button>)}
    </div>
  </div>;
}

export function AvatarEditorView({ controller, onClose, triggerRef, agentIsGroup = false }: AvatarEditorViewProps) {
  const snapshot = useController(controller);
  const editorRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const [description, setDescription] = useState("");
  const source = snapshot.source;
  const crop = snapshot.crop;
  const isBusy = snapshot.isSaving || snapshot.isCommitting;
  const hasExistingAvatar = snapshot.hasExistingAvatar;
  const close = () => { controller.setOpen(false); onClose(); };
  useEffect(() => {
    const editor = editorRef.current;
    if (editor == null) return;
    const onPointerDownOutside = (event: globalThis.PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || editor.contains(target) || triggerRef?.current?.contains(target) === true) return;
      close();
    };
    const onWindowKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("pointerdown", onPointerDownOutside);
    window.addEventListener("keydown", onWindowKeyDown, true);
    editor.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDownOutside);
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [triggerRef, onClose]);
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "v") event.stopPropagation();
  };
  const onPasteCapture = (event: ClipboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    const item = Array.from(event.clipboardData.items).find((candidate) => candidate.kind === "file" && candidate.type.toLowerCase().startsWith("image/"));
    const file = item?.getAsFile();
    event.stopPropagation();
    if (snapshot.mode !== "upload") controller.setMode("upload");
    if (file == null) return;
    event.preventDefault();
    void controller.pasteFile(file);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (pointer == null || pointer.pointerId !== event.pointerId) return;
    controller.pan(event.clientX - pointer.lastX, event.clientY - pointer.lastY);
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const save = async () => { if (await controller.save()) close(); };
  const reset = async () => {
    if (snapshot.stagedCharacter != null) { if (await controller.commitStagedCharacter()) close(); return; }
    if (await controller.clearAvatar()) close();
  };
  const imageStyle = source == null || crop == null ? undefined : (() => {
    const scale = 260 / Math.min(source.width, source.height) * crop.zoom;
    return { width: source.width * scale, height: source.height * scale, transform: `translate(${130 - crop.centerX * scale}px, ${130 - crop.centerY * scale}px)` };
  })();
  const hasCustomCharacter = snapshot.persistedCharacter.avatarShape != null || snapshot.persistedCharacter.avatarColor != null;
  return <div aria-label="Avatar editor" className="sand-avatar-editor" onKeyDownCapture={onKeyDownCapture} onPasteCapture={onPasteCapture} ref={editorRef} role="dialog" tabIndex={-1}>
    <div className="sand-78zum5 sand-6s0dn4 sand-ehausa sand-2lah0s sand-9f619 sand-13ly8rp sand-1yxiud8 sand-1xlntvz sand-yab65l sand-1co6499 sand-1q0q8m5 sand-17fyfba">
      <div aria-label="Avatar source" className="sand-78zum5 sand-6s0dn4 sand-137clkk sand-1iyjqo2 sand-euugli" role="tablist">
        {agentIsGroup ? null : <button aria-selected={snapshot.mode === "bot"} onClick={() => controller.setMode("bot")} role="tab" type="button">Bot</button>}
        <button aria-selected={snapshot.mode === "generate"} onClick={() => controller.setMode("generate")} role="tab" type="button">Generate</button>
        <button aria-selected={snapshot.mode === "upload"} onClick={() => controller.setMode("upload")} role="tab" type="button">Upload</button>
      </div>
      {hasExistingAvatar ? <button aria-label="Reset to the Bot" disabled={isBusy} onClick={() => void reset()} type="button">Reset</button> : snapshot.mode === "bot" && hasCustomCharacter ? <button aria-label="Reset character to default" disabled={isBusy} onClick={() => void controller.resetCharacter()} type="button">Reset</button> : null}
    </div>
    {source != null && crop != null ? <div className="sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-ehausa">
      <div aria-label="Drag to reposition" className="sand-avatar-editor__stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} role="img">
        <img alt="" draggable={false} src={source.dataUrl} style={imageStyle} />
        <span aria-hidden="true" />
      </div>
      <div className="sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-137clkk sand-2b8uid">{snapshot.fileName == null ? null : <span>{`${snapshot.fileName} · ${source.width}×${source.height}`}</span>}<span>Drag to reposition</span></div>
      <div className="sand-avatar-editor__zoom">
        <button aria-label="Zoom out" disabled={isBusy} onClick={() => controller.setZoom(crop.zoom - .5)} type="button">−</button>
        <input aria-label="Zoom" disabled={isBusy} max={5} min={1} onChange={(event) => controller.setZoom(Number.parseFloat(event.currentTarget.value))} step={.01} type="range" value={crop.zoom} />
        <button aria-label="Zoom in" disabled={isBusy} onClick={() => controller.setZoom(crop.zoom + .5)} type="button">+</button>
      </div>
      <div><button disabled={isBusy} onClick={() => controller.resetCrop()} type="button">Restart</button><button disabled={isBusy} onClick={() => void save()} type="button">{snapshot.isSaving ? "Saving…" : "Set avatar"}</button></div>
    </div> : snapshot.mode === "bot" ? <>
      <CharacterChooser controller={controller} snapshot={snapshot} />
      <PresenceMotionSetting />
      {hasExistingAvatar && snapshot.stagedCharacter != null ? <div><button disabled={isBusy} onClick={close} type="button">Cancel</button><button disabled={isBusy} onClick={() => void reset()} type="button">{snapshot.isCommitting ? "Saving…" : "Set avatar"}</button></div> : null}
    </> : snapshot.isGenerating ? <div>
      <input aria-label="Describe your avatar" readOnly type="text" value={description.trim()} />
      <div aria-label="Generating avatar" role="status"><span aria-hidden="true" /></div>
      <button disabled type="button">Generating…</button>
    </div> : snapshot.mode === "upload" ? <div className="sand-avatar-editor__dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const file = Array.from(event.dataTransfer.files).find((candidate) => candidate.type.toLowerCase().startsWith("image/")); if (file != null) void controller.ingestFile(file); }}><span>Drag, drop, or paste an image</span><span>or</span><button onClick={() => void controller.pickFile()} type="button">Browse files</button></div> : <div>
      <textarea aria-label="Describe your avatar" onChange={(event) => setDescription(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void controller.generate(description); } }} placeholder="Describe your avatar…" value={description} />
      <button disabled={description.trim().length === 0 || snapshot.isGenerating} onClick={() => void controller.generate(description)} type="button">Generate</button>
    </div>}
    {snapshot.error == null ? null : <div aria-live="polite" role="status">{snapshot.error}</div>}
    {source == null && !(snapshot.mode === "bot" && hasExistingAvatar && snapshot.stagedCharacter != null) ? <div><button disabled={isBusy} onClick={close} type="button">Cancel</button></div> : null}
  </div>;
}
