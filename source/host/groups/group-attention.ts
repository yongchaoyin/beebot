import {
  isPassContent, parseGroupMentions, resolveMessageResponders,
  type GroupMember, type GroupMessage,
} from "./group-chat.js";

export type AttentionReason = "explicit-recipients" | "quiet" | "directed" | "discussion"
  | "pending-conversation" | "unavailable" | "quoted-request" | "answer-to-user" | "first-listener";
export interface GroupAttention {
  reason: AttentionReason;
  members: GroupMember[];
  unavailableIds?: readonly string[];
}
export interface AttentionContext {
  history: readonly GroupMessage[];
  load?: (id: string) => number;
  /** Only persisted, room-local delivery identities; never model-provided IDs. */
  priorRecipients?: (messageId: string) => readonly string[] | undefined;
  pendingRecipients?: (messageId: string) => readonly string[] | undefined;
}

/** Pick attention, not authority or task ownership. No model call, text classifier,
 * capability claim, role hierarchy, or automatic retry of another Bot's work.
 * Shared/cross-user rooms keep their existing protocol instead of using this policy.
 */
export function selectGroupAttention(
  members: readonly GroupMember[], message: GroupMessage, context: AttentionContext,
): GroupAttention {
  const eligible = resolveMessageResponders(members, [message]);
  if (message.recipientIds) return { reason: "explicit-recipients", members: eligible };
  if (message.awaitingUser || isPassContent(message.content)
    || (message.speaker.kind === "member" && message.purpose === "update")) {
    return { reason: "quiet", members: [] };
  }
  const mentions = parseGroupMentions(message.content, members);
  if (!mentions.isEveryone && !mentions.memberIds.length && message.replyToMemberId
    && !members.some(member => member.id === message.replyToMemberId)) {
    return { reason: "unavailable", members: [], unavailableIds: [message.replyToMemberId] };
  }
  if (mentions.isEveryone || mentions.memberIds.length || message.replyToMemberId) {
    return { reason: "directed", members: eligible };
  }
  if (message.speaker.kind === "member" && message.purpose === "discussion") {
    return { reason: "discussion", members: eligible };
  }
  const parent = message.replyToId
    ? context.history.find(entry => entry.id === message.replyToId) : undefined;
  if (parent?.speaker.kind === "user") {
    if (message.speaker.kind === "member") {
      // Deliver an answer to the human in the same room; it is not a request for
      // every peer to acknowledge it. Explicit @ / discussion still works above.
      return { reason: "answer-to-user", members: [] };
    }
    const prior = context.priorRecipients?.(parent.id!) ?? [];
    const addressed = eligible.filter(member => prior.includes(member.id));
    if (addressed.length) return { reason: "quoted-request", members: addressed };
    // The addressed colleague may have left. Do not silently give their old
    // external work to someone else, even when a different member is idle.
    if (prior.length) return { reason: "unavailable", members: [], unavailableIds: prior };
  }
  if (message.speaker.kind === "user" && !message.replyToId) {
    const at = context.history.findIndex(entry => entry.id === message.id);
    const before = at >= 0 ? context.history.slice(0, at) : context.history;
    const previous = [...before].reverse().find(entry => entry.speaker.kind === "user");
    const pending = previous?.id ? context.pendingRecipients?.(previous.id) ?? [] : [];
    if (pending.length) {
      const targets = eligible.filter(member => pending.includes(member.id));
      return targets.length ? { reason: "pending-conversation", members: targets }
        : { reason: "unavailable", members: [], unavailableIds: pending };
    }
  }
  const load = (id: string) => {
    const value = context.load?.(id) ?? 0;
    return Number.isFinite(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER;
  };
  // A stable, room-local tie-break, independent of names and array ordering.
  // Different requests can select different colleagues; this never appoints a lead.
  const seed = message.id ?? JSON.stringify([message.speaker, message.content]);
  const rank = (id: string) => {
    let value = 2166136261;
    for (const char of `${seed}\0${id}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return value >>> 0;
  };
  const ordered = [...eligible].sort((a, b) => load(a.id) - load(b.id)
    || rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { reason: "first-listener", members: ordered.slice(0, 1) };
}

export const LOCAL_ATTENTION_GUIDANCE = `Local group attention: not every colleague runs on every message. A new open user request has one first listener, selected for current availability, not seniority or verified skill. Unquoted follow-ups to the latest pending user request stay with its recipients; this is attention continuity, NOT an inferred scope change. Read every new message and clarify important ambiguity. Only explicit user instructions and validated work revisions change execution boundaries. Being that listener does NOT appoint you coordinator or give you new permissions. Answer simple questions directly. For genuine help, quote the relevant message and @ the colleague who can answer with purpose:request. A request for advice is not a transfer of the original responsibility. Use purpose:update for progress that needs no response; use purpose:discussion or @everyone deliberately when you need group input. An answer quoted to the user does not automatically summon peers. Speak only for yourself and never simulate colleagues' replies. If you cannot handle a directed request, state the limitation or ask a targeted question instead of silently assuming another member will respond. Ordinary questions and discussion do not require creating a formal task. Do not interpret a review request as permission to edit, send or deploy. Task claim, version, review and external-action authorization checks still apply.`;
