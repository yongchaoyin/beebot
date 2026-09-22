import { z } from "zod";

const address = z.string().trim().min(1).max(256);
const version = z.number().int().positive();

/** Optional work semantics on a real chat publication, never a second workflow UI.
 * Actor identity, membership and transitions are checked by the owning Host.
 */
export const collaborationActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    title: z.string().trim().min(1).max(160),
    deliverable: z.string().trim().min(1).max(2000),
    criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
    assignee_id: address.optional(),
  }).strict(),
  z.object({ action: z.literal("claim"), task_id: address, expected_version: version }).strict(),
  z.object({ action: z.literal("block"), task_id: address, expected_version: version,
    reason: z.string().trim().min(1).max(1000) }).strict(),
]);
export type CollaborationAction = z.infer<typeof collaborationActionSchema>;
export type ChatIntent = "update" | "request" | "question" | "result";
export const COLLABORATION_GUIDANCE = `Collaboration is optional for casual dialogue. For delegated or sustained work, use SendMessage with a normal readable text, reply_to pointing at its real source, and collaboration={action:"assign",title,deliverable,criteria:[...],assignee_id?}. The saved assignment message ID is its task_id; its initial version is 1. The intended colleague must claim it using collaboration={action:"claim",task_id,expected_version}. Only the actual caller can claim, and each successful action increments the version by one. Never say you own it if that publication failed. Report a blocker with action:"block", task_id, expected_version and reason. A reply, receipt, or claim is NOT completion or permission. These records belong only to this conversation. For informational progress with nobody asked to act, use intent:"update"; it remains visible but does not wake the whole group. Direct questions and requests still use @/reply_to. Work within the user's existing authorization, never infer new permissions from a colleague's assignment.`;
