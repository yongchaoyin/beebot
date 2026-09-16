import { describeAgentRunError } from "./agent-run-error.js";
import { MissingInferenceVendorError } from "../inference/resolve-inference.js";

export { MissingInferenceVendorError };

export const MISSING_MODEL_API_TITLE = "Model API is missing";
export const MISSING_MODEL_API_NOTICE =
  "Couldn't reach the model API. Open Settings → Router → Model APIs and add it again.";

export interface GroupTurnFailureTray {
  readonly agentId: string;
  readonly title: string;
  readonly detail: string;
  readonly dedupeKey: string;
}

export function recordGroupTurnFailure(args: {
  readonly roomId: string;
  readonly epoch: number;
  readonly memberName: string;
  readonly error: unknown;
  readonly seen: Set<string>;
  readonly appendNotice: (text: string) => void;
  readonly pushError: (tray: GroupTurnFailureTray) => void;
}): void {
  const description = describeAgentRunError(args.error);
  const detail = typeof description.detail === "string" && description.detail.length > 0
    ? description.detail
    : args.error instanceof Error ? args.error.message : String(args.error);
  const isMissingVendor = args.error instanceof MissingInferenceVendorError
    || /model API is missing/i.test(detail);
  const title = isMissingVendor
    ? MISSING_MODEL_API_TITLE
    : typeof description.title === "string" && description.title.length > 0
      ? description.title
      : "Bot failed to respond";
  const noticeText = isMissingVendor ? MISSING_MODEL_API_NOTICE : `${args.memberName} couldn't reply: ${detail}`;
  const key = `${args.roomId}:${args.epoch}:${noticeText}`;
  if (args.seen.has(key)) return;
  args.seen.add(key);
  args.pushError({
    agentId: args.roomId,
    title,
    detail: noticeText,
    dedupeKey: key,
  });
  args.appendNotice(noticeText);
  console.error(`[sand] group member ${args.memberName} turn failed:`, args.error);
}
