import type * as ReactAPI from "react";
import { characterVariant, characterLayers, type AvatarLayer } from "./avatar-art";
import { registerAvatarMotion, gestureAvatarIdentity, type AvatarMotionHandle } from "./avatar-motion";
import { normalizeAvatarState } from "./avatar-state";

export interface PresenceCharacterHandle { spin(): void; bounce(): void; burst(): void }
export interface PresenceCharacterProps {
  shape?: string; color?: string; state?: string; paused?: boolean; sizePx?: number;
  sourceId?: string; emphasis?: boolean; isFollowingPointer?: boolean;
  followTarget?: { x: number; y: number } | null; spinSignal?: number;
  className?: string; avatarIdentity?: string; motionPriority?: number; surfaceTheme?: string; pointerShown?: boolean;
}
const REACT_ATTRS: Record<string, string> = { "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap", "stroke-opacity": "strokeOpacity" };
/** Use the existing React singleton in both source and packaged renderers. */
export function createPresenceCharacter(React: typeof ReactAPI) {
  const h = React.createElement;
  return React.forwardRef<PresenceCharacterHandle, PresenceCharacterProps>(function PresenceCharacter(props, ref) {
    const { shape = "blob", color = "blue", state = "idle", paused = false, sizePx, sourceId, spinSignal = 0, className, motionPriority, isFollowingPointer, avatarIdentity } = props;
    const svg = React.useRef<SVGSVGElement>(null);
    const motion = React.useRef<AvatarMotionHandle | null>(null);
    const previousSignal = React.useRef(spinSignal);
    const identity = React.useRef(avatarIdentity); identity.current = avatarIdentity;
    React.useImperativeHandle(ref, () => {
      const play = (kind: "nod" | "greet" | "ack") => {
        if (svg.current && identity.current) gestureAvatarIdentity(svg.current.ownerDocument, identity.current, kind);
        else motion.current?.gesture(kind);
      };
      return { spin: () => play("greet"), bounce: () => play("nod"), burst: () => play("ack") };
    }, []);
    React.useEffect(() => {
      if (!svg.current || paused) return;
      motion.current = registerAvatarMotion(svg.current, { state, paused, size: sizePx, priority: motionPriority, followingPointer: isFollowingPointer, identity: avatarIdentity });
      return () => { motion.current?.destroy(); motion.current = null; };
    }, [paused]);
    React.useEffect(() => { motion.current?.update({ state, paused, size: sizePx, priority: motionPriority, followingPointer: isFollowingPointer, identity: avatarIdentity }); }, [state, paused, sizePx, motionPriority, isFollowingPointer, avatarIdentity]);
    React.useEffect(() => {
      if (spinSignal !== previousSignal.current) { previousSignal.current = spinSignal; motion.current?.gesture("greet"); }
    }, [spinSignal]);
    const layers = characterLayers(shape, color);
    const render = (layer: AvatarLayer, index: number) => h(layer.tag, {
      key: `${layer.part}-${index}`, ...Object.fromEntries(Object.entries(layer.attrs).map(([key, value]) => [REACT_ATTRS[key] ?? key, value])),
      "data-part": layer.part, ...(layer.part === "mouth" ? { className: "bb-character__mouth" } : {}),
    });
    return h("svg", { ref: svg, viewBox: "0 0 64 64", width: sizePx, height: sizePx, className: ["bb-character", className].filter(Boolean).join(" "), "data-state": normalizeAvatarState(state), "data-paused": paused, "data-variant": characterVariant(shape), "aria-hidden": true, focusable: false },
      h("g", { id: sourceId, className: "bb-character__body" },
        ...layers.filter(layer => layer.part === "body" || layer.part === "detail").map(render),
        h("g", { className: "bb-character__face" },
          h("g", { className: "bb-character__eyes" }, ...layers.filter(layer => layer.part === "eyes").map(render)),
          ...layers.filter(layer => layer.part === "mouth").map(render))));
  });
}
