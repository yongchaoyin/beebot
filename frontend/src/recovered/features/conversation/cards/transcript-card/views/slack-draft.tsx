import * as React from "react";
import { createDraftDeliveryCard } from "../draft-delivery";
import { projectLeafEntry, useTranscriptCardLeafProviders, type TranscriptCardLeafProps } from "./shared";

const Card=createDraftDeliveryCard(React);
/** Uses the same delivery card as the patched pinned lazy renderer. */
export function SlackDraftTranscriptCard(props:TranscriptCardLeafProps){
  const entry=projectLeafEntry(props.entry),providers=useTranscriptCardLeafProviders();
  if(entry?.message.type!=="slack-draft")return null;
  return <Card entry={entry} adapter={providers?.draftDelivery||null} />;
}
export default SlackDraftTranscriptCard;
