import { z } from "zod";

const id = z.string().trim().min(1).max(256);
const requirements = z.array(z.string().trim().min(1).max(600)).min(1).max(12);
const change = { operation_id: id, task_id: id, expected_version: z.number().int().positive() };
/** Structured companions to ordinary quoted messages, never extra tool authority. */
export const collaborationCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("offer"), operation_id: id, title: z.string().trim().min(1).max(160),
    assignee_id: id.optional(), reviewer_id: id.optional(), requirements,
    depends_on: z.array(id).max(12).default([]) }).strict(),
  z.object({ action: z.literal("claim"), ...change }).strict(),
  z.object({ action: z.literal("block"), ...change }).strict(),
  z.object({ action: z.literal("resume"), ...change }).strict(),
  z.object({ action: z.literal("revise"), ...change, requirements }).strict(),
  z.object({ action: z.literal("submit"), ...change, result_ids: z.array(id).min(1).max(12) }).strict(),
  z.object({ action: z.literal("review"), ...change, submission_id: id,
    decision: z.enum(["accept", "request_changes"]),
    checks: z.array(z.object({ criterion: z.number().int().min(1).max(12), passed: z.boolean(),
      evidence_ids: z.array(id).min(1).max(8) }).strict()).min(1).max(12) }).strict(),
]);
export type CollaborationCommand = z.infer<typeof collaborationCommandSchema>;
export const workStateSchema = z.object({
  schema: z.literal(1), id, sourceId: id, requesterId: id,
  assigneeId: id.nullable(), reviewerId: id.nullable(), ownerId: id.nullable(),
  title: z.string(), requirements, dependsOn: z.array(id), version: z.number().int().positive(),
  state: z.enum(["offered", "claimed", "blocked", "submitted", "changes_requested", "accepted"]),
  latestMessageId: id,
  submission: z.object({ id, results: z.array(z.object({ id, digest: z.string().regex(/^[a-f0-9]{64}$/) })) }).nullable(),
}).strict();
export type CollaborationWork = z.infer<typeof workStateSchema>;
export interface WorkEvent {
  schema: 1; taskId: string; version: number; title: string; state: CollaborationWork["state"];
  action: CollaborationCommand["action"]; actorId: string; ownerId: string | null;
  requesterId: string; reviewerId: string | null; recipients: string[];
  /** The Host, never the model, records authenticated user review. */
  reviewerKind?: "user";
}
export const WORK_AGENT_GUIDANCE = `For a delegated deliverable (not every chat message), use SendMessage type:text with a collaboration object and a normal conversational body. Quote the source message with reply_to. Offer: {action:"offer",operation_id:"stable-unique-key",title,assignee_id?,reviewer_id?,requirements:[concrete acceptance criteria],depends_on:[existing task IDs]}. The returned message ID is the task ID. The requester is only this task's coordinator, never a permanent boss. An offer is not a claim: the assignee must claim before treating itself as responsible. Claim/block/resume: {action,operation_id,task_id,expected_version}. Submit: {action:"submit",operation_id,task_id,expected_version,result_ids:[already published result/evidence message IDs]}. Quote the original offer when handing in results. Review: {action:"review",operation_id,task_id,expected_version,submission_id,decision:"accept"|"request_changes",checks:[{criterion:1,passed:true,evidence_ids:[message IDs]}]}. Only the designated reviewer, never the owner, can accept; all criteria need evidence. This records peer review, NOT user approval or permission. In a solo chat results stay submitted until the user reviews them inline; do not invent a reviewer or impersonate $user. Human acceptance is not permission for unrelated operations. The requester can revise pending requirements with action:"revise" and requirements; stale versions fail and accepted work is immutable. Read the current work records below, use one stable operation_id on retries, and never change input under that ID. Acknowledge, clarify or share progress without changing task state. In a group only, use notify:"none" for informational progress with no request (even quoted progress); use ordinary @/quoted messages for questions and help. Dependencies must pass review before claim or submission. Waiting does not mean polling; let the relevant result wake you. For a user question about recorded work, preserve work_on as its task ID; the Host scopes validity to that work and known user context. An unrelated quoted task can continue without invalidating this question; unscoped user changes remain conservative. Ordinary questions never grant authority, and urgent changes still require explicit Stop. These structured operations do not reserve files or grant new tools.`;
