import { requireMessageReference } from "./message-reply-contract.js";
import {
  withReplyTo,
  type SendMessage,
} from "./send-message-shaping.js";
import type { TranscriptEntry } from "./transcript-hub.js";
export function resolveSendReplyThreading(
  tm: {
    turnRuntime: {
      resolveReplyTarget(
        entries: readonly TranscriptEntry[],
        id: string,
      ): string | undefined;
      buildReplyContext(
        entries: readonly TranscriptEntry[],
        id?: string,
      ): unknown;
    };
  },
  replyToIdOption: string | undefined,
  isForkOption: boolean,
  readAddressedTranscript: () => readonly TranscriptEntry[],
): { replyToId?: string; replyContext: unknown; isFork: boolean } {
  const entries = replyToIdOption ? readAddressedTranscript() : [];
  if (replyToIdOption) requireMessageReference(entries, replyToIdOption);
  const replyToId = replyToIdOption
      ? tm.turnRuntime.resolveReplyTarget(entries, replyToIdOption)
      : undefined,
    replyContext = tm.turnRuntime.buildReplyContext(entries, replyToId);
  return {
    ...(replyToId == null ? {} : { replyToId }),
    replyContext,
    isFork: isForkOption && replyToId != null,
  };
}
export function validateAiReplyTarget<T extends SendMessage>(
  message: T,
  inFlightId: string | undefined,
  entries: readonly TranscriptEntry[],
): T {
  if (message.reply_to != null) requireMessageReference(entries, message.reply_to, "reply_to", inFlightId);
  if (message.work_on != null) requireMessageReference(entries, message.work_on, "work_on", inFlightId);
  return message;
}
export function applyAutoReplyThread<T extends SendMessage>(
  tm: { turnRuntime: { replyThreadTargets: ReadonlyMap<object, string> } },
  message: T,
  session: object | null,
  entries: readonly TranscriptEntry[],
): T {
  if (message.reply_to || session == null) return message;
  const target = tm.turnRuntime.replyThreadTargets.get(session);
  return target != null && entries.some((entry) => entry.id === target)
    ? withReplyTo(message, target)
    : message;
}
