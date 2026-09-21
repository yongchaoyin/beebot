import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformSync } from "esbuild";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../frontend/src/recovered/features/conversation/workspace/composer.tsx", import.meta.url), "utf8");
// Component contract test, not a React lifecycle/DOM test. Child controls and
// hooks are replaced, but the actual composer source and handlers execute.
function load() {
  const module = { exports: {} };
  const component = name => Object.defineProperty(() => null, "name", { value: name });
  const hooks = { useCallback: fn => fn, useMemo: fn => fn(), useRef: value => ({ current: value }), useState: value => [value, () => {}], useEffect: () => {} };
  const modules = {
    react: hooks,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" },
    "./model": { COMPOSER_ATTACHMENT_LIMIT: 10, isComposerDraftEmpty: draft => !draft.prompt.trim() && !draft.attachments.length },
    "./voice": { useVoiceSession: () => ({ controller: {}, isRecording: false, isProcessing: false, isActivating: false }), VoiceWaveform: component("VoiceWaveform") },
    "./reply-preview": { ComposerReplyPill: component("ReplyPill"), replyComposerPlaceholder: () => "Reply" },
    "./rich-text-editor": { PromptRichTextEditor: component("PromptRichTextEditor") },
    "../../../ui/sand-kit-primitives": { SandIcon: component("SandIcon"), SandIconButton: component("SandIconButton") },
    "../../../ui/sand-status-primitives": { SandSpinner: component("SandSpinner") },
  };
  // TypeScript 7 does not expose the legacy transpileModule API. Keep compiler
  // transformation on the repository's pinned esbuild instead of another TS copy.
  const { code } = transformSync(source, {
    loader: "tsx", target: "es2022", format: "cjs", jsx: "automatic", sourcefile: "composer.tsx",
  });
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return module.exports.ConversationComposer;
}
function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const match = find(child, predicate); if (match) return match; }
  return null;
}
for (const disabled of [false, true]) for (const submitDisabled of [false, true]) test(`composer edit=${!disabled} submitGate=${submitDisabled}`, () => {
  const Composer = load(); let sends = 0, changed;
  const tree = Composer({ draft: { prompt: "准备中的草稿", attachments: [] }, disabled, submitDisabled, enableVoice: false, enableAttachments: false, onChange: draft => { changed = draft.prompt; }, onSubmit: () => { sends++; }, onStageFiles: () => {}, transcribeAudio: async () => ({ text: "" }) });
  const editor = find(tree, node => node.type?.name === "PromptRichTextEditor");
  assert.equal(editor.props.disabled, disabled);
  assert.equal(editor.props.canSubmit, !disabled && !submitDisabled);
  const send = find(tree, node => node.type === "button" && node.props["aria-label"] === "Send message");
  assert.equal(send.props.disabled, disabled || submitDisabled);
  tree.props.onSubmit({ preventDefault() {} });
  assert.equal(sends, !disabled && !submitDisabled ? 1 : 0);
  if (!disabled) { editor.props.onChange({ prompt: "继续编辑" }); assert.equal(changed, "继续编辑"); }
});
