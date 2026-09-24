import type { ReactElement } from "react";
import type { SharedJoinRequest } from "./model";
import { WorkspaceIcon } from "../../conversation/workspace/workspace-icon";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4871665 (OTn shared-room header trigger; UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6117799 (OTn shared-room header trigger; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4871947 (Manage shared room labels; UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6118179 (Manage shared room labels; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)

export interface SharedRoomHeaderTriggerProps {
  readonly roomId: string | null;
  readonly pendingJoinRequests: readonly Pick<SharedJoinRequest, "roomId">[];
  readonly isEnabled: boolean;
  readonly disabled?: boolean;
  readonly onOpen: () => void;
}

export function SharedRoomHeaderTrigger({ roomId, pendingJoinRequests, isEnabled, disabled = false, onOpen }: SharedRoomHeaderTriggerProps): ReactElement | null {
  if (!isEnabled || roomId == null || roomId.length === 0) return null;
  const pendingCount = pendingJoinRequests.filter((request) => request.roomId === roomId).length;
  const label = pendingCount === 0
    ? "Manage shared room"
    : `Manage shared room, ${pendingCount} pending join ${pendingCount === 1 ? "request" : "requests"}`;
  return <button aria-label={label} disabled={disabled} onClick={onOpen} title={label} type="button">
    <WorkspaceIcon name="people" />
    {pendingCount > 0 ? <span aria-hidden="true">•</span> : null}
  </button>;
}
