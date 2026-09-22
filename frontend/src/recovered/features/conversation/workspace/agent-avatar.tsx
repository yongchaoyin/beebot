import { useId, useMemo, type CSSProperties } from "react";
import { resolvePersonaColor, resolvePersonaShape } from "../../onboarding/signed-in/character";
import { PresenceCharacter } from "../../../../presence/components";
import type { OnboardingCharacterState } from "../../onboarding/signed-in/scene";
import { avatarStateFromAgent, type AvatarState, type AvatarActivity } from "../../../../presence/avatar-state";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2302348 (Iee avatar dispatcher; Mac SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182a3dcd717...)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=2925837 (Iee avatar dispatcher; Windows SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=2921693 (Eee/Cee/QCe/hct/gct/dln persona mappings)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=2755564 (sd sand-grok-bot-mark wrapper)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=2933499 (sand-group-avatar and sand-shared-room-avatar branches)
// Presence owns the persona drawing; dispatcher semantics remain unchanged.
// The dispatcher order is artifact data URL -> shared-room -> group -> persona
// mark. There is deliberately no initials or CSS-generated fallback branch.

export type AgentAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AgentAvatarKind = "agent" | "group" | "shared-room";
export type PersonaState = OnboardingCharacterState | AvatarState;

export interface AgentAvatarProps {
  readonly agentId: string;
  readonly name?: string;
  readonly dataUrl?: string | null;
  readonly shape?: string | null;
  readonly color?: string | null;
  readonly size?: AgentAvatarSize;
  readonly kind?: AgentAvatarKind;
  readonly memberIds?: readonly string[];
  readonly state?: PersonaState;
  readonly currentActivity?: unknown | null;
  readonly isRunning?: boolean;
  readonly isComposingMessage?: boolean;
  readonly awaitingUserResponse?: unknown | null;
  readonly waitingReason?: string;
  readonly isTransportDown?: boolean;
  readonly isPaused?: boolean;
  readonly hasError?: boolean;
  readonly motionPriority?: number;
  readonly isStatic?: boolean;
  readonly paused?: boolean;
  readonly isFollowingPointer?: boolean;
  readonly followTarget?: { x: number; y: number } | null;
  readonly emphasis?: boolean;
  readonly spinSignal?: number;
}

const SIZE_PX: Record<AgentAvatarSize, number> = { xs: 16, sm: 22, md: 28, lg: 36, xl: 72 };

/** Shared projection also used by the packaged renderer; stale tool history
 * cannot keep an idle coworker visibly working. */
export function personaStateFromAgent(input: AvatarActivity): PersonaState {
  return avatarStateFromAgent(input);
}

function avatarState(props: AgentAvatarProps): PersonaState {
  return props.state ?? personaStateFromAgent(props);
}

function avatarStyle(sizePx: number): CSSProperties {
  return { height: sizePx, width: sizePx };
}

function PersonaMark({ agentId, color, shape, size, sizePx, state, isStatic, paused, isFollowingPointer, followTarget, emphasis, spinSignal, motionPriority }: { agentId: string; color: string; shape: string; state: PersonaState; size?: AgentAvatarSize } & Pick<AgentAvatarProps, "isStatic" | "paused" | "isFollowingPointer" | "followTarget" | "emphasis" | "spinSignal" | "motionPriority"> & { sizePx: number }) {
  const source = useId();
  return <span aria-hidden="true" className="sand-agent-avatar sand-grok-bot-mark" data-avatar-color={color} data-avatar-shape={shape} data-size={typeof size === "string" ? size : undefined} data-emphasis={emphasis || undefined} style={avatarStyle(sizePx)}>
    <PresenceCharacter
      color={color}
      emphasis={emphasis}
      followTarget={followTarget}
      isFollowingPointer={isFollowingPointer}
      paused={paused === true || isStatic === true}
      shape={shape}
      sizePx={sizePx}
      sourceId={`bb-avatar-${source}`}
      motionPriority={motionPriority}
      spinSignal={spinSignal}
      state={state}
    />
  </span>;
}

function SharedRoomAvatar({ sizePx }: { sizePx: number }) {
  return <span aria-hidden="true" className="sand-agent-avatar sand-shared-room-avatar" data-avatar-kind="shared-room" style={avatarStyle(sizePx)}>
    <svg aria-hidden="true" style={{ fill: "none", height: "65%", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.5, width: "65%" }} viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2 2.1 3 4.8 3 8s-1 5.9-3 8c-2-2.1-3-4.8-3-8s1-5.9 3-8Z" /></svg>
  </span>;
}

function groupSlots(count: number, frame: number): Array<{ x: number; y: number; size: number }> {
  if (count <= 1) return [{ x: 0, y: 0, size: frame }];
  if (count === 2) { const size = frame * 2 / 3; return [{ x: 0, y: 0, size }, { x: frame - size, y: frame - size, size }]; }
  const size = frame * 5 / 9, offset = frame - size;
  return count === 3
    ? [{ x: offset / 2, y: 0, size }, { x: 0, y: offset, size }, { x: offset, y: offset, size }]
    : [{ x: 0, y: 0, size }, { x: offset, y: 0, size }, { x: 0, y: offset, size }, { x: offset, y: offset, size }];
}

function GroupAvatar({ agentId, memberIds, sizePx, state, isStatic, paused }: { agentId: string; memberIds: readonly string[]; sizePx: number; state: PersonaState; isStatic?: boolean; paused?: boolean }) {
  const participants = memberIds.length === 0 ? [agentId] : memberIds;
  const visible = participants.slice(0, participants.length > 4 ? 3 : 4);
  const slots = groupSlots(Math.min(visible.length + (participants.length > 4 ? 1 : 0), 4), sizePx);
  return <span aria-hidden="true" className="sand-agent-avatar sand-group-avatar" data-avatar-kind="group" data-member-count={participants.length} style={avatarStyle(sizePx)}>
    {visible.slice(0, slots.length).map((memberId, index) => {
      const color = resolvePersonaColor(memberId);
      const shape = resolvePersonaShape(memberId);
      const slot = slots[index];
      return <span key={memberId} style={{ display: "block", height: slot.size, left: slot.x, overflow: "hidden", position: "absolute", top: slot.y, width: slot.size }}><PersonaMark agentId={memberId} color={color} isStatic={isStatic ?? true} paused={paused} shape={shape} sizePx={slot.size} state={state} /></span>;
    })}
    {participants.length > 4 ? <span style={{ background: "var(--cursor-bg-elevated)", border: "1px solid var(--cursor-stroke-secondary)", borderRadius: "var(--cursor-radius-full)", bottom: 0, color: "var(--cursor-text-primary)", display: "grid", fontSize: 9, lineHeight: 1, minHeight: 13, minWidth: 13, padding: "1px 3px", placeItems: "center", position: "absolute", right: 0 }}>+{participants.length - 3}</span> : null}
  </span>;
}

export function AgentAvatar(props: AgentAvatarProps) {
  const size = props.size ?? "md";
  const sizePx = SIZE_PX[size];
  const state = avatarState(props);
  const color = useMemo(() => resolvePersonaColor(props.agentId, props.color), [props.agentId, props.color]);
  const shape = useMemo(() => resolvePersonaShape(props.agentId, props.shape), [props.agentId, props.shape]);
  const dataUrl = typeof props.dataUrl === "string" && props.dataUrl.length > 0 ? props.dataUrl : null;
  const kind = props.kind ?? "agent";
  if (dataUrl != null) return <img alt="" aria-hidden="true" className="sand-agent-avatar" data-avatar-kind="photo" data-size={size} draggable={false} height={sizePx} src={dataUrl} style={avatarStyle(sizePx)} width={sizePx} />;
  if (kind === "shared-room") return <SharedRoomAvatar sizePx={sizePx} />;
  if (kind === "group") return <GroupAvatar agentId={props.agentId} memberIds={props.memberIds ?? []} paused={props.paused} sizePx={sizePx} state={state} />;
  return <PersonaMark agentId={props.agentId} motionPriority={props.motionPriority} color={color} emphasis={props.emphasis} followTarget={props.followTarget} isFollowingPointer={props.isFollowingPointer} isStatic={props.isStatic} paused={props.paused} shape={shape} size={size} sizePx={sizePx} spinSignal={props.spinSignal} state={state} />;
}
