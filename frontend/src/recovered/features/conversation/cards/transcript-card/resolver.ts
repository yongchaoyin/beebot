import { createElement } from "react";
import "./view.css";
import type { TranscriptCardProtocolKey } from "./protocol";
import { createTranscriptCardRegistry, type TranscriptCardRegistry, type TranscriptCardViewLoaders, type TranscriptCardViewModule } from "./registry";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5108848 (immutable dynamic import map)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=784036 (lazy card metadata projection)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5119020 (unknown-card fail-closed branch)
const TRANSCRIPT_CARD_VIEW_LOADERS: TranscriptCardViewLoaders = {
  "send-message:text": async () => await import("./views/send-message-text"),
  "send-message:widget": async () => await import("./views/widget"),
  "send-message:cursor-agent": async () => await import("./views/cloud-agent"),
  "send-message:email-draft": async () => await import("./views/email-draft"),
  "send-message:slack-draft": async () => await import("./views/slack-draft"),
  "send-message:auto-review-approval": async () => await import("./views/auto-review-approval"),
  "send-message:listener-connect": async () => await import("./views/listener-connect"),
  "send-message:secret-request": async () => await import("./views/secret-request"),
  "send-message:attachment": async () => await import("./views/attachment"),
  "send-message:connector": async () => await import("./views/connector"),
  "send-message:connectors": async () => await import("./views/connectors"),
  "send-message:local-tool-permission": async () => await import("./views/local-tool-permission"),
};

export interface TranscriptCardLeafResolver extends TranscriptCardRegistry {
  readonly loaders: Readonly<TranscriptCardViewLoaders>;
  fallback(protocolKey: string): TranscriptCardViewModule;
}

function fallbackView() {
  return {
    default: () => createElement("div", { "aria-live": "polite", className: "sand-transcript-card-fallback", role: "note" }, "This message can’t be shown in this version of BeeBot"),
  };
}

export function createTranscriptCardLeafResolver(loaders: TranscriptCardViewLoaders = TRANSCRIPT_CARD_VIEW_LOADERS): TranscriptCardLeafResolver {
  const registry = createTranscriptCardRegistry(loaders);
  return {
    loaders,
    metadata: registry.metadata,
    load: registry.load,
    fallback: fallbackView,
  };
}

export async function loadTranscriptCardLeaf(protocolKey: TranscriptCardProtocolKey, resolver: TranscriptCardLeafResolver = createTranscriptCardLeafResolver()): Promise<TranscriptCardViewModule> {
  try {
    return await resolver.load(protocolKey) ?? resolver.fallback(protocolKey);
  } catch {
    // A lazy card is optional transcript content. Preserve the transcript host
    // when its chunk is unavailable or malformed; the immutable host renders
    // the same unknown-card fallback for an unsupported card protocol.
    return resolver.fallback(protocolKey);
  }
}
