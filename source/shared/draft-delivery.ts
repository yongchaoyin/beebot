import { z } from "zod";

const email=z.string().trim().min(3).max(320).email();
export const emailDraftSchema=z.object({from:email.optional(),to:z.array(email).min(1).max(100),cc:z.array(email).max(100).optional(),subject:z.string().max(1000),body:z.string().min(1).max(100_000).refine(value=>value.trim().length>0,"Message body is required")}).strict();
export const slackDraftSchema=z.object({workspace:z.string().trim().min(1).max(256).optional(),target:z.string().trim().min(1).max(256),thread:z.string().trim().min(1).max(256).optional(),body:z.string().min(1).max(40_000).refine(value=>value.trim().length>0,"Message body is required")}).strict();
export const draftMessageSchema=z.discriminatedUnion("type",[z.object({type:z.literal("email-draft"),draft:emailDraftSchema}).strict(),z.object({type:z.literal("slack-draft"),draft:slackDraftSchema}).strict()]);
export type DraftMessage=z.infer<typeof draftMessageSchema>;
export const draftQuerySchema=z.object({agentId:z.string().trim().min(1).max(256),entryId:z.string().trim().min(1).max(256)}).strict();
export const draftActionSchema=draftQuerySchema.extend({requestId:z.string().trim().min(1).max(128),expectedVersion:z.number().int().nonnegative(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/),action:z.enum(["send","discard"]),expectedSenderHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),senderId:z.string().trim().min(1).max(512).optional(),message:draftMessageSchema.optional()}).strict().superRefine((value,ctx)=>{if(value.action==="send"&&!value.expectedSenderHash)ctx.addIssue({code:"custom",path:["expectedSenderHash"],message:"Reload and confirm the current sender before sending."});});
export type DraftAction=z.infer<typeof draftActionSchema>;
export type DraftDeliveryState="editable"|"sending"|"sent"|"needs-review"|"discarded";
export interface DraftDeliveryView {
  agentId:string;entryId:string;version:number;hash:string;state:DraftDeliveryState;message:DraftMessage;
  receipt?:{messageId:string};error?:string;senders?:{id:string;label:string;bindingHash:string}[];
}
