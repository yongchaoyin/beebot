import type { DesktopBridge } from "../../../contracts/desktop-bridge";
import { accessCoverCopy, openAccessOnboarding, type SandAccess } from "./model";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5537116
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5421612
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5544624 (sand-access-cover selector)
// Immutable root sha256: ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa

export interface AccessCoverProps {
  readonly access: SandAccess;
  readonly bridge: Pick<DesktopBridge, "openExternal">;
  readonly isVisible: boolean;
}

export function AccessCover({ access, bridge, isVisible }: AccessCoverProps) {
  if (!isVisible) return null;
  const copy = accessCoverCopy(access);
  return (
    <div className="sand-access-cover">
      <div className="sand-onboarding__landing">
        <h1 id="sand-access-cover-heading">BeeBot</h1>
        <p>Your team of always-on agents that finish the work.</p>
        <div>
          <div>
            <div><span>{copy.title}</span><span>{copy.body}</span></div>
            {copy.action === null ? null : <button onClick={() => void openAccessOnboarding(bridge)} type="button">{copy.action}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
