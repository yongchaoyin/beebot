import { OverlayDialog } from "../../../ui/overlay-primitives";
import { SandButton, SandIconButton } from "../../../ui/sand-kit-primitives";
import { deepLinkRoute, deepLinkSourceLabel, type DeepLinkInfo } from "./model";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L523
// Immutable root sha256: ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa

export interface DeepLinkInfoDialogProps {
  link: DeepLinkInfo | null;
  onClose: () => void;
}

export function DeepLinkInfoDialog({ link, onClose }: DeepLinkInfoDialogProps) {
  if (link == null) return null;
  return <OverlayDialog className="sand-deep-link-info" label="Deep Links" onClose={onClose} open>
    <header>
      <div>
        <h2>Deep Links</h2>
        <p>BeeBot deep links are working</p>
      </div>
      <SandIconButton aria-label="Close" icon="close" label="Close" onClick={onClose} size="sm" type="button" />
    </header>
    <div>
      <div>
        <p>Route</p>
        <code>{deepLinkRoute(link)}</code>
      </div>
      <div>
        <p>Source</p>
        <code>{deepLinkSourceLabel(link.source)}</code>
      </div>
    </div>
    <footer><SandButton onClick={onClose} size="md" type="button">Done</SandButton></footer>
  </OverlayDialog>;
}

export default DeepLinkInfoDialog;
