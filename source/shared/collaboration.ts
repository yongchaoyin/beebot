import { z } from "zod";

const address = z.string().trim().min(1).max(256);
const version = z.number().int().positive();
const refs = z.array(address).max(24).default([]);
const requiredRefs = z.array(address).min(1).max(24);
const checks = z.array(z.object({criterion: z.number().int().min(0).max(11), passed: z.boolean(),
  evidence_ids: requiredRefs, note: z.string().trim().min(1).max(1000)}).strict()).min(1).max(12);
const common = { request_id: z.string().trim().min(1).max(128) };
const task = { ...common, task_id: address, expected_version: version };

/** SendMessage remains the conversation surface. This structured sidecar records
 * commitments; prose is never interpreted as proof of a state transition. */
export const workPinSchema = z.object({id: address, version}).strict();
export const collaborationActionSchema = z.discriminatedUnion("action", [
  z.object({...common, action: z.literal("finish"), goal_message_id: address,
    expected_tasks: z.array(workPinSchema).min(1).max(256), result_ids: requiredRefs,
  }).strict(),
  z.object({ ...common, action: z.literal("assign"), goal_message_id: address,
    title: z.string().trim().min(1).max(240), assignee: address,
    reviewer: address.default("user"), criteria: z.array(z.string().trim().min(1).max(600)).min(1).max(12),
    dependencies: refs,
  }).strict(),
  z.object({ ...task, action: z.literal("decline"), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ ...task, action: z.literal("reassign"), assignee: address, reviewer: address,
    reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ ...task, action: z.literal("claim") }).strict(),
  z.object({ ...task, action: z.literal("wait"), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ ...task, action: z.literal("revise"), source_message_id: address,
    title: z.string().trim().min(1).max(240), criteria: z.array(z.string().trim().min(1).max(600)).min(1).max(12),
  }).strict(),
  z.object({ ...task, action: z.literal("submit"), result_ids: requiredRefs, evidence_ids: requiredRefs }).strict(),
  z.object({ ...task, action: z.literal("review"), submission_id: address,
    verdict: z.enum(["accept", "changes"]), checks }).strict(),
  z.object({ ...task, action: z.literal("progress"), evidence_ids: refs }).strict(),
  z.object({ ...task, action: z.literal("block"), reason: z.string().trim().min(1).max(1000) }).strict(),
]);
export type CollaborationAction = z.infer<typeof collaborationActionSchema>;
export const MESSAGE_PURPOSES = ["request", "update", "discussion"] as const;
export type MessagePurpose = typeof MESSAGE_PURPOSES[number];

export const workEvidenceSchema = z.object({
  id: address, digest: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(z.object({url: z.string().max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().min(0).max(64 * 1024 * 1024)}).strict()).max(8),
}).strict();
export type WorkEvidence = z.infer<typeof workEvidenceSchema>;
export const collaborationTaskSchema = z.object({
  id: address, goalId: address, creator: address, assignee: address, reviewer: address,
  title: z.string().min(1).max(240), criteria: z.array(z.string().min(1).max(600)).min(1).max(12),
  dependencies: z.array(address).max(24), version,
  state: z.enum(["offered", "declined", "claimed", "blocked", "waiting", "review", "changes-requested", "accepted"]),
  scopeVersion: version.default(1), revisionSourceId: address.optional(),
  submission: z.object({id: address, scopeVersion: version, resultIds: requiredRefs,
    evidenceIds: requiredRefs, manifest: z.array(workEvidenceSchema).max(48),
    dependencyVersions: z.array(z.object({id: address, version}).strict()).max(24),
  }).strict().optional(),
  review: z.object({id: address, reviewer: address, submissionId: address, verdict: z.enum(["accept", "changes"]), checks,
    // Optional only to read pre-upgrade history. Such acceptance needs a fresh
    // review; current evidence must never be passed off as its historical basis.
    manifest: z.array(workEvidenceSchema).min(1).max(288).optional(),
  }).strict().optional(),
  claimedBy: address.optional(), reason: z.string().max(1000).optional(),
  evidenceIds: z.array(address).max(24), updatedBy: address, updatedMessageId: address,
}).strict();
export type CollaborationTask = z.infer<typeof collaborationTaskSchema>;
export const collaborationEventSchema = z.object({
  format: z.literal(1), actor: address, requestId: address, digest: z.string().regex(/^[a-f0-9]{64}$/),
  task: collaborationTaskSchema, wake: z.array(address).max(24),
}).strict();
export type CollaborationEvent = z.infer<typeof collaborationEventSchema>;

/** A finish receipt pins the full known work set. It is not a claim that every
 * informal requirement has been discovered, nor permission to publish/deploy. */
export const collaborationCompletionSchema = z.object({
  format: z.literal(1), actor: address, requestId: address, digest: z.string().regex(/^[a-f0-9]{64}$/),
  id: address, goalId: address, tasks: z.array(workPinSchema).min(1).max(256),
  manifest: z.array(workEvidenceSchema).min(1).max(24),
}).strict();
export type CollaborationCompletion = z.infer<typeof collaborationCompletionSchema>;

export const collaborationReviewRequestSchema = z.object({
  agentId: address, reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  review: z.object({...task, action: z.literal("review"), submission_id: address,
    verdict: z.enum(["accept", "changes"]), checks}).strict(),
}).strict();
