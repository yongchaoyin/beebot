import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { COMPOSER_ATTACHMENT_LIMIT, attachmentBasename, formatAttachmentBytes, inferAttachmentKind, isComposerDraftEmpty, type ComposerDraft, type DraftAttachment } from "./model";
import { useVoiceSession, VoiceWaveform, type VoiceTranscriber } from "./voice";
import { ComposerReplyPill, replyComposerPlaceholder, type ComposerReplyTarget } from "./reply-preview";
import { PromptRichTextEditor, type PromptEditorControls, type PromptEditorProviders } from "./rich-text-editor";
import { SandIcon, SandIconButton } from "../../../ui/sand-kit-primitives";
import { SandSpinner } from "../../../ui/sand-status-primitives";

// Immutable Mac voice carriers: index-UbX-y3il.js#byteOffset=4538599 (recording
// chip/waveform), 4539081 (Stop dictation), and 4543238 (mic action).
// Windows equivalents: 5703580, 5704161, and 5709324.

const PROMPT_ATTACH_CLASS = "sand-prompt-attach sand-2lah0s sand-i07v4r sand-uo9n5k sand-1vhj7fz sand-4b2ntj sand-1dsx48b sand-1hc1fzr sand-1lfpgzf sand-1ypdohk";
const PROMPT_MIC_EMPTY_CLASS = "sand-prompt-mic sand-2lah0s sand-jbqb8w sand-uo9n5k sand-19aaqeu sand-1dsx48b sand-1hc1fzr sand-1lfpgzf sand-19991ni sand-13dflua sand-12w9bfk sand-b51amx";
const PROMPT_MIC_PAYLOAD_CLASS = "sand-prompt-mic sand-2lah0s sand-jbqb8w sand-uo9n5k sand-19aaqeu sand-1dsx48b sand-1ypdohk sand-19991ni sand-13dflua sand-12w9bfk sand-b51amx sand-g01cxk";
const PROMPT_SEND_CLASS = "sand-prompt-send sand-2lah0s sand-mak4db sand-1tc92z3 sand-1hc1fzr sand-1p5hr7d sand-1lfpgzf sand-1ypdohk";
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4540240 (Nl.glyphShown/glyphHidden opacity+scale classes)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=5705592 (Windows prompt glyph state classes)
const COMPOSER_GLYPH_VISIBLE_CLASS = "sand-1hc1fzr sand-3oybdh";
const COMPOSER_GLYPH_HIDDEN_CLASS = "sand-g01cxk sand-1a33avv";
const RECORDING_CHIP_CLASS = "sand-recording-chip sand-9f619 sand-3nfvp2 sand-pkkfsy sand-1th6cxs sand-f6zju3 sand-16b7oty sand-cnij5n sand-o7x2bt sand-2lah0s sand-c342km sand-ng3xce sand-1i4c3av sand-i07v4r sand-1kj6vsg sand-1ypdohk sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-1uczgqu sand-1725o6r sand-omy3lu";

function ComposerGlyph({ name, hidden = false }: { readonly name: "mic" | "arrow-up"; readonly hidden?: boolean }) {
  return <SandIcon className={hidden ? COMPOSER_GLYPH_HIDDEN_CLASS : COMPOSER_GLYPH_VISIBLE_CLASS} name={name} size="sm" style={{ lineHeight: 1 }} variant="filled" />;
}

// Immutable prompt editor keyboard contract: Escape cancels an active voice
// session or blurs the prompt when no voice session is active.
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4738296 (e9n prompt editor; UTF-8 region SHA-256 0a96b805946245180330a9bffda0053e11015e9c8fe850dfa62361ab85acee35)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=5948419 (e9n prompt editor; UTF-8 region SHA-256 6f8b718ba4e43704baea5078c9498184b98f82a3ad84d47bf1e5a9f516988f07)

export interface ConversationComposerProps {
  draft: ComposerDraft;
  disabled?: boolean;
  /** Block submission without preventing the user from preparing a draft. */
  submitDisabled?: boolean;
  notice?: string | null;
  placeholder?: string;
  transcribeAudio: VoiceTranscriber;
  onChange(draft: ComposerDraft): void;
  onStageFiles(files: File[]): void | Promise<void>;
  onSubmit(): void | Promise<void>;
  onRemoveAttachment?(attachment: DraftAttachment): void | Promise<void>;
  replyTarget?: ComposerReplyTarget;
  onClearReplyTarget?(): void;
  editorProviders?: PromptEditorProviders;
  scopeKey?: string;
  acceptedSendGeneration?: number;
  /** Capability gates: hide unsupported controls without changing local defaults. */
  enableAttachments?: boolean;
  enableVoice?: boolean;
}

export function extractClipboardFiles(items: DataTransferItemList | null | undefined): File[] {
  if (items == null) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file != null) files.push(file);
  }
  return files;
}

export function hasFileDragData(types: Iterable<string> | null | undefined): boolean {
  if (types == null) return false;
  for (const type of types) if (type === "Files") return true;
  return false;
}

export function selectComposerFiles(files: readonly File[], existingCount: number): File[] {
  const remaining = Math.max(0, COMPOSER_ATTACHMENT_LIMIT - existingCount);
  return files.slice(0, remaining);
}

export function ConversationComposer({ acceptedSendGeneration = 0, draft, disabled = false, submitDisabled = false, notice, placeholder = "Ask anything, or drop a file.", transcribeAudio, onChange, onClearReplyTarget, onRemoveAttachment, onStageFiles, onSubmit, replyTarget, editorProviders, scopeKey, enableAttachments = true, enableVoice = true }: ConversationComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const editorControls = useRef<PromptEditorControls | null>(null);
  const dragDepth = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const draftRef = useRef(draft);
  const hasPayload = !isComposerDraftEmpty(draft);
  draftRef.current = draft;
  const voiceOptions = useMemo(() => ({ transcribe: transcribeAudio }), [transcribeAudio]);
  const voice = useVoiceSession(voiceOptions, scopeKey);
  const voiceBusy = voice.isRecording || voice.isProcessing || voice.isActivating;
  const canSend = hasPayload && !disabled && !submitDisabled && !voiceBusy;
  const atLimit = draft.attachments.length >= COMPOSER_ATTACHMENT_LIMIT;

  useEffect(() => voice.controller.onFinal((text) => {
    editorControls.current?.insertText(text);
    const focusEditor = () => editorControls.current?.focus();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusEditor);
    else focusEditor();
  }), [voice.controller]);

  useEffect(() => {
    if ((disabled || !enableVoice) && voiceBusy) voice.handleCancelClick();
  }, [disabled, enableVoice, voiceBusy, voice.handleCancelClick]);

  useEffect(() => {
    if (acceptedSendGeneration > 0) editorControls.current?.clear();
  }, [acceptedSendGeneration]);

  const cancelVoiceAndRefocus = useCallback(() => {
    voice.handleCancelClick();
    const focusEditor = () => editorControls.current?.focus();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusEditor);
    else focusEditor();
  }, [voice.handleCancelClick]);

  const receiveEditorControls = useCallback((controls: PromptEditorControls | null) => {
    editorControls.current = controls;
  }, []);

  const onEditorChange = useCallback((change: { readonly prompt: string; readonly richText?: string }) => {
    onChange({
      ...draftRef.current,
      prompt: change.prompt,
      richText: change.richText
    });
  }, [onChange]);

  const stageFiles = useCallback((files: readonly File[]) => {
    if (!enableAttachments) return;
    const accepted = selectComposerFiles(files, draft.attachments.length);
    if (accepted.length > 0) void onStageFiles(accepted);
  }, [draft.attachments.length, enableAttachments, onStageFiles]);

  const stageSelectedFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    stageFiles(files);
  };

  const hasDraggedFiles = useCallback((event: DragEvent<HTMLDivElement>) => enableAttachments && hasFileDragData(event.dataTransfer?.types), [enableAttachments]);
  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragOver(true);
  }, [hasDraggedFiles]);
  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer != null) event.dataTransfer.dropEffect = "copy";
  }, [hasDraggedFiles]);
  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  }, [hasDraggedFiles]);
  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);
    stageFiles(Array.from(event.dataTransfer?.files ?? []));
  }, [hasDraggedFiles, stageFiles]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) void onSubmit();
  };

  return (
    <form className="sand-prompt-form" onSubmit={submit}>
      <div className="sand-prompt-shell" data-expanded={hasPayload || undefined} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
        {isDragOver ? <div aria-hidden="true" className="sand-chat-drop-overlay"><div className="sand-chat-drop-overlay__badge">Drop files to add to chat</div></div> : null}
        {notice ? <p aria-live="polite" className="sand-prompt-attachment-notice" role="status">{notice}</p> : null}
        {replyTarget == null || onClearReplyTarget == null ? null : <ComposerReplyPill onClear={onClearReplyTarget} target={replyTarget} />}
        {draft.attachments.length > 0 ? (
          <div aria-label="Attachments" className="sand-prompt-attachments" role="list">
            {draft.attachments.map((attachment, index) => {
              const label = attachment.name || attachmentBasename(attachment.path);
              return <span aria-label={label} className="sand-prompt-attachment" data-kind={inferAttachmentKind({ mimeType: attachment.mimeType, fileName: label, urlOrPath: attachment.path })} key={`${attachment.path}:${index}`} role="listitem">
                <span><strong>{attachment.name}</strong>{attachment.size == null ? null : <small>{formatAttachmentBytes(attachment.size)}</small>}</span>
                <button aria-label={`Remove ${label}`} onClick={() => {
                  onChange({ ...draft, attachments: draft.attachments.filter((candidate) => candidate !== attachment) });
                  void onRemoveAttachment?.(attachment);
                }} type="button"><SandIcon name="close" size="xs" /></button>
              </span>;
            })}
          </div>
        ) : null}
        <PromptRichTextEditor
          canSubmit={canSend}
          clearGeneration={acceptedSendGeneration}
          disabled={disabled}
          onChange={onEditorChange}
          onControls={receiveEditorControls}
          onEscape={() => {
            if (voiceBusy) cancelVoiceAndRefocus();
            else editorControls.current?.blur();
          }}
          onPasteFiles={stageFiles}
          onSubmit={onSubmit}
          placeholder={replyTarget == null ? placeholder : replyComposerPlaceholder(replyTarget.preview)}
          prompt={draft.prompt}
          providers={editorProviders}
          richText={draft.richText}
          scopeKey={scopeKey}
        />
        {voice.isRecording || voice.isActivating ? <span aria-live="polite" className="sand-prompt-voice-status" role="status">Listening…</span> : null}
        <div className="sand-prompt-actions-row">
          {enableAttachments ? <SandIconButton aria-label="Attach file" className={PROMPT_ATTACH_CLASS} disabled={disabled || atLimit || voiceBusy} icon="plus" onClick={() => fileInput.current?.click()} shape="circle" size="lg" type="button" variant="default" /> : <span />}
          <span className="sand-prompt-actions-trailing sand-prompt-cta-cluster sand-78zum5 sand-6s0dn4 sand-2lah0s">
            {voice.isRecording ? <button aria-label="Stop dictation" className={RECORDING_CHIP_CLASS} onClick={() => voice.handleStopClick()} onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelVoiceAndRefocus();
              }
            }} type="button">
              <span aria-hidden="true" className="sand-recording-chip__stop sand-1fsd2vl sand-170jfvy sand-2lah0s sand-1bl94mz sand-mak4db" />
              <span aria-hidden="true" className="sand-recording-chip__timer sand-2lah0s sand-fc7y3v sand-1yxxptd sand-1bignsj sand-ss6m8b">{voice.recordingDuration}</span>
              <span className="sand-recording-chip__waveform sand-1xp8n7a sand-18gnavp sand-2lah0s sand-78zum5 sand-6s0dn4"><VoiceWaveform stream={voice.stream} /></span>
            </button> : voice.isProcessing ? <span aria-label="Transcribing voice input…" className="sand-prompt-voice-processing sand-2lah0s sand-16w9d4f sand-1th6cxs sand-78zum5 sand-6s0dn4 sand-l56j7k" role="status"><SandSpinner ariaLabel="Transcribing voice input…" size={18} />Transcribing…</span> : <>
              {hasPayload && enableVoice ? <SandIconButton aria-label="Start voice input" className={PROMPT_MIC_PAYLOAD_CLASS} disabled={disabled || voiceBusy} icon="mic" onClick={() => voice.handleMicClick()} shape="circle" size="lg" type="button" variant="default" /> : null}
              {hasPayload || !enableVoice ? <button aria-label="Send message" className={PROMPT_SEND_CLASS} disabled={!canSend} type="submit"><span className="sand-1n2onr6 sand-1kky2od sand-lup9mm"><ComposerGlyph hidden={true} name="mic" /><ComposerGlyph name="arrow-up" /></span></button> : <SandIconButton aria-label="Start voice input" className={PROMPT_MIC_EMPTY_CLASS} disabled={disabled} icon="mic" onClick={() => voice.handleMicClick()} shape="circle" size="lg" type="button" variant="default" />}
            </>}
          </span>
        </div>
        {voice.error ? <p aria-live="polite" className="sand-prompt-voice-error" role="status">{voice.error.message}</p> : null}
        {enableAttachments ? <input aria-hidden="true" className="sand-prompt-file-input" multiple onChange={stageSelectedFiles} ref={fileInput} tabIndex={-1} type="file" /> : null}
      </div>
    </form>
  );
}
