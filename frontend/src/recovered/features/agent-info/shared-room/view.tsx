import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import type { SharedRoomProvider } from "./controller";
import type { SharedRoomAgent, SharedRoomContext } from "./model";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4888002 (sand-shared-room-dialog; UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6139090 (sand-shared-room-dialog; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4881533 (Invite people; UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6130641 (Invite people; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4888619 (shared-room invite copy; UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6139858 (shared-room invite copy; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4885953 (Pending requests); UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6136396 (Pending requests); UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4889015 (People); UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6140352 (People); UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4889647 (Your agents); UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6141132 (Your agents); UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)

export interface SharedRoomDialogProps {
  readonly provider: SharedRoomProvider;
  readonly roomId: string;
  readonly agentId: string;
  readonly accountGeneration: number;
  readonly agents: readonly SharedRoomAgent[];
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

function InviteLink({ result }: { result: { readonly shareUrl: string } }): ReactElement {
  const [status, setStatus] = useState<"ready" | "copied" | "error">("ready");
  const copy = async (): Promise<void> => {
    try {
      await globalThis.navigator?.clipboard?.writeText(result.shareUrl);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  };
  return <div>
    <input aria-label="Room link" onFocus={(event) => event.currentTarget.select()} readOnly spellCheck={false} value={result.shareUrl} />
    <button onClick={() => { void copy(); }} type="button">{status === "copied" ? "Copied" : status === "error" ? "Try again" : "Copy link"}</button>
  </div>;
}

export function SharedRoomDialog({ provider, roomId, agentId, accountGeneration, agents, isOpen, onClose }: SharedRoomDialogProps): ReactElement | null {
  const snapshot = useSyncExternalStore(provider.subscribe, provider.getSnapshot, provider.getSnapshot);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const context: SharedRoomContext = { roomId, agentId, accountGeneration, agents };

  useEffect(() => {
    provider.setContext(isOpen ? context : null);
  }, [provider, roomId, agentId, accountGeneration, agents, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreRef.current?.focus();
      restoreRef.current = null;
    };
  }, [isOpen, onClose]);

  if (!isOpen || snapshot.room == null) return null;
  const room = snapshot.room;
  const humanMembers = room.members.filter((member) => member.kind === "human");
  const selfAuthId = snapshot.state?.selfAuthId;
  return <div aria-label={room.name} aria-modal="true" className="sand-shared-room-dialog" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} ref={dialogRef} role="dialog" tabIndex={-1}>
    <header><h2>{room.name}</h2></header>
    {snapshot.isHost ? <section>
      <p>Invite people</p>
      {snapshot.invite?.status === "ok" ? <InviteLink result={snapshot.invite} /> : snapshot.invite?.status === "error" ? <p role="alert">{snapshot.invite.message}</p> : <button disabled={snapshot.pendingAction === "invite"} onClick={() => { void provider.createRoomInvite(); }} type="button">Copy link</button>}
      <p>They paste this link into BeeBot via Cmd-K, then "Join shared room". Each request waits for your approval.</p>
    </section> : null}
    {snapshot.requests.length > 0 ? <section>
      <h3>Pending requests</h3>
      {snapshot.requests.map((request) => <div key={request.requestId}>
        <span>{request.requesterName}</span>
        <button aria-label={`Deny ${request.requesterName}`} disabled={snapshot.pending.has(`request:${request.requestId}`)} onClick={() => { void provider.respondToRoomJoinRequest(request.requestId, false); }} type="button">Deny</button>
        <button aria-label={`Approve ${request.requesterName}`} disabled={snapshot.pending.has(`request:${request.requestId}`)} onClick={() => { void provider.respondToRoomJoinRequest(request.requestId, true); }} type="button">Approve</button>
      </div>)}
    </section> : null}
    <section>
      <h3>People</h3>
      {humanMembers.map((member) => <div key={member.authId}>
        <span>{member.displayName}</span>
        {member.authId === room.hostAuthId ? <span>Host</span> : snapshot.isHost ? <button aria-label={`Remove ${member.displayName}`} onClick={() => { void provider.leaveSharedRoom(member.authId); }} type="button">Remove</button> : null}
      </div>)}
    </section>
    <section>
      <h3>Your agents</h3>
      {snapshot.context?.agents.filter((agent) => !agent.isGroup && agent.remoteRoom == null && agent.isSharedRoom !== true).map((agent) => {
        const isSelf = snapshot.selfAgentIds.includes(agent.id);
        return <div key={agent.id}><span>{agent.name}</span><button aria-label={`${isSelf ? "Remove" : "Add"} ${agent.name}`} disabled={snapshot.pending.has(`agent:${agent.id}`)} onClick={() => { void (isSelf ? provider.removeOwnAgent(agent.id) : provider.addOwnAgent(agent)); }} type="button">{isSelf ? "Remove" : "Add"}</button></div>;
      })}
    </section>
    <footer><button onClick={onClose} type="button">Done</button></footer>
    <span hidden>{selfAuthId}</span>
  </div>;
}
