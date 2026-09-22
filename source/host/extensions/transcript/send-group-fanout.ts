import { deliverGroupMessage } from "./group-message-delivery.js";
import { dirname } from "node:path";
import { readSandGroupConfig } from "../../groups/group-store.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";

export async function dispatchMirrorOrGroupSend(
  tm: TranscriptManagerLike,
  args: any,
): Promise<boolean> {
  const {
    session,
    trimmedPrompt,
    selectedImages,
    videoAttachmentPaths,
    fileAttachmentPaths,
    clientNonce,
    userMessageId,
    awaitTurn,
    acceptedAtMs,
    traceCtx,
    readAddressedTranscript,
    markSendAccepted,
  } = args;
  if (tm.groupChat.isRemoteRoomSession(session)) {
    await tm.sharedRooms.dispatchMirrorRoomSend(session, {
      text: trimmedPrompt,
      selectedImages,
      hasNonImageAttachments:
        videoAttachmentPaths.length > 0 || fileAttachmentPaths.length > 0,
      clientNonce,
    });
    markSendAccepted(clientNonce);
    return true;
  }
  if (!tm.groupChat.isGroupSession(session)) return false;
  const sharedRoomId = readSandGroupConfig(
    dirname(session.dbPath),
  )?.sharedRoomId;
  if (sharedRoomId != null && userMessageId != null) {
    const userEntry = readAddressedTranscript().find(
      (candidate: any) => candidate.id === userMessageId,
    );
    if (userEntry != null)
      tm.xuserDelegate?.publishRoomEntry(sharedRoomId, userEntry);
  }
  if (typeof userMessageId !== "string")
    throw new Error("A group message needs a durable source message before dispatch.");
  const { done } = await deliverGroupMessage(tm, session, userMessageId, traceCtx);
  markSendAccepted(clientNonce);
  if (awaitTurn) await done;
  else
    void done.catch((error: unknown) =>
      console.error(
        "[sand] detached group turn failed after send acceptance:",
        error,
      ),
    );
  return true;
}
