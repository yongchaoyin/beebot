import type { ReactNode } from "react";
import type { WorkState } from "../../../../honeyline/status";
import type { RendererAgent } from "../../../../production/model";
import { ComputerHeaderControl } from "../../computer/shell/view";
import { SharedRoomHeaderTrigger, type SharedRoomHeaderTriggerProps } from "../../agent-info/shared-room/trigger";
import { HoneylineWorkStatus } from "../../../../honeyline/components";
import { AgentAvatar } from "./agent-avatar";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4886695 (ChatHeader aSn)
// The shipped normal-agent branch owns the settings trigger, conversation-details
// control, identity projection, and working-state copy. Agent Settings itself is
// owned by the separate agent-info surface and is intentionally not mounted here.

export interface ConversationAgentHeaderProps {
  agent: Pick<RendererAgent, "id" | "name" | "isRunning" | "isComposingMessage" | "awaitingUserResponse" | "currentActivity" | "avatarDataUrl" | "avatarShape" | "avatarColor" | "isSharedRoom" | "memberIds"> & WorkState & { isGroup?: boolean };
  isComputerActive: boolean;
  isInfoOpen: boolean;
  onToggleInfo(): void;
  onToggleSettings?(): void;
  sharedRoomTrigger?: SharedRoomHeaderTriggerProps;
  trailing?: ReactNode;
  /** Remote transports may not expose a computer surface. Defaults to the local behavior. */
  showComputerControl?: boolean;
}

export function ConversationAgentHeader({ agent, isComputerActive, isInfoOpen, onToggleInfo, onToggleSettings, sharedRoomTrigger, trailing, showComputerControl = true }: ConversationAgentHeaderProps) {
  const avatarKind = agent.isSharedRoom === true ? "shared-room" : agent.isGroup === true ? "group" : "agent";
  const identity = <>
    <span className="sand-chat-header__avatar"><AgentAvatar agentId={agent.id} kind={avatarKind} memberIds={agent.memberIds} dataUrl={agent.avatarDataUrl} color={agent.avatarColor} shape={agent.avatarShape} currentActivity={agent.currentActivity} isComposingMessage={agent.isComposingMessage} isRunning={agent.isRunning} awaitingUserResponse={agent.awaitingUserResponse} size="md" /></span>
    <span id="sand-conversation-heading">{agent.name}</span>
    <HoneylineWorkStatus agent={agent} />
  </>;
  return <div aria-labelledby="sand-conversation-heading" className="sand-chat-header" role="group">
    {onToggleSettings == null
      ? <div className="sand-chat-header__identity">{identity}</div>
      : <button aria-controls="sand-conversation-details" aria-expanded={isInfoOpen} aria-label="View agent settings" className="sand-chat-header__identity" data-info-row="settings" onClick={onToggleSettings} type="button">{identity}</button>}
    <div className="sand-chat-header__controls">
      {sharedRoomTrigger == null ? null : <SharedRoomHeaderTrigger {...sharedRoomTrigger} />}
      {agent.isGroup || !showComputerControl ? null : <ComputerHeaderControl active={isComputerActive} isInfoOpen={isInfoOpen} onToggle={onToggleInfo} />}
      {trailing}
    </div>
  </div>;
}
