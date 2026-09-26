import * as React from "react";
import { createConversationNotice, isRoutineConversationNotice } from "../../../../../presence/conversation-notice";
import type { TranscriptNotice } from "../../workspace/model";
import { TranscriptCardTimestamp } from "../timeline-event";

// @evidence src/app/dist/renderer/assets/view-1r0bwdK4.js#byteOffset=172 (notice card utility frame)
// @evidence src/app/dist/renderer/assets/view-1r0bwdK4.js#byteOffset=253 (notice card selector)
const NOTICE_CLASS = "sand-notice sand-amitd3 sand-1yrsyyn sand-nuq7ks sand-10b6aqq sand-f18ygs sand-2b8uid";

const ConversationNotice = createConversationNotice(React);

/** Shipped notice:notice transcript card, mounted at the existing notice union branch. */
export function TranscriptNoticeCard({ entry }: { entry: TranscriptNotice }) {
  if (isRoutineConversationNotice(entry)) return null;
  return <div className="sand-transcript-row" data-entry-id={entry.id} role="note">
    <ConversationNotice entry={entry} original={<div className={NOTICE_CLASS}><span>{entry.text}</span></div>} />
    <TranscriptCardTimestamp timestampMs={entry.timestampMs} />
  </div>;
}
