import type { ReactNode } from "react";

import { sandIconGlyph, sandIconStyle } from "../../../ui/sand-icon-registry";
import type { SandIconName } from "../../../ui/sand-icon-registry";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#sha256=ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa#byteOffset=126718 (chat-bubbles),128247 (cube-nodes),134644 (megaphone),135554 (plus),136076 (search)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#sha256=80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5#byteOffset=171603 (chat-bubbles),173720 (cube-nodes),182413 (megaphone),183778 (plus),184559 (search)

export type WorkspaceIconName = SandIconName;

export function WorkspaceIcon({ name, size = "base" }: { readonly name: WorkspaceIconName; readonly size?: "sm" | "base" }): ReactNode {
  return <span aria-hidden="true" className="ui-icon" data-icon-name={name} data-size={size} style={sandIconStyle(size)}>{sandIconGlyph(name)}</span>;
}
