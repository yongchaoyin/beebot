import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
// Static call-site guards supplement (not replace) real React and queue tests.
const source = await readFile(new URL('../frontend/src/production/ProductionRenderer.tsx',import.meta.url),'utf8');
test('editable production composer keeps editability separate from work and attachment submission',()=>{
  const composer=source.match(/<ConversationComposer acceptedSendGeneration[^\n]+/)?.[0];assert.ok(composer);
  assert.match(composer,/disabled=\{client == null\}/);
  assert.match(composer,/submitDisabled=\{\(attachmentStages\[activeAgent.id\] \?\? 0\) > 0\}/);
  assert.doesNotMatch(composer,/busy/);
});
test('production hands off the draft locally and never clears newer text from an old receipt',()=>{
  const submit=source.slice(source.indexOf('  const submit = () => {'),source.indexOf('  const removeTranscriptMessage ='));
  assert.match(submit,/composerSubmissionQueue.submit\(submission\)/);
  assert.match(submit,/clearDraftIfCurrent\(draftIdentity\)/);
  assert.doesNotMatch(submit,/completion\.then|clearDraftIfCurrent\(draftIdentity\)\s*\|\|/);
  const failure=source.slice(source.indexOf('    onFailure: (submission, error)'),source.indexOf('  useStrictModeSafeDisposal(composerSubmissionQueue)'));
  assert.doesNotMatch(failure,/recoverDraft\(/);
});
test('account invalidation fences receipt callbacks and the pre-dispatch attachment await',()=>{
  assert.match(source,/accountScopeGenerationRef.current \+= 1;\s*composerSubmissionQueue.reset\(\)/);
  const send=source.slice(source.indexOf('  const sendComposerPrompt ='),source.indexOf('  const [sendJournalApprovalLifecycle]'));
  assert.ok(send.indexOf('accountScopeGenerationRef.current !== accountGeneration') > send.indexOf('await commitComposerAttachments'));
  assert.ok(send.indexOf('accountScopeGenerationRef.current !== accountGeneration') < send.indexOf('await client.call("sendPrompt"'));
  assert.match(source,/sendPrompt: \(submission\) => sendComposerPromptRef.current\(submission\)/);
});
test('native adapters still build shared Presence CSS and status, rather than an alternate theme copy',async()=>{
  const text=(await Promise.all(['build-presence.mjs','presence-renderer-patch.mjs'].map(name=>readFile(new URL('../scripts/lib/'+name,import.meta.url),'utf8')))).join('\n');
  assert.match(text,/presence\/packaged-ui/);assert.match(text,/presence\/presence.css/);
});
test('a stale queued-cancel action cannot remove an already dispatched message',()=>{
  const cancel=source.slice(source.indexOf('  const cancelQueuedSend ='),source.indexOf('  const setAgentHiddenFromSidebar ='));
  assert.doesNotMatch(cancel,/removeTranscriptMessage\(entry\)/);
  assert.match(cancel,/original.replyToId/);assert.match(cancel,/original.richText/);
});
