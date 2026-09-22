import type * as ReactAPI from "react";
import { characterVariant, characterLayers, SVG_ATTRIBUTES, type AvatarPart } from "./avatar-art";
import { normalizePresence } from "./state";
import { registerAvatarMotion, gestureVisibleAvatar, type AvatarMotionHandle, type AvatarSurface, type MotionOptions } from "./motion";

export interface PresenceCharacterHandle { spin(): void; bounce(): void; burst(): void }
export interface PresenceCharacterProps {
  shape?: string; color?: string; state?: string; paused?: boolean; sizePx?: number;
  sourceId?: string; identityKey?: string; emphasis?: boolean; isFollowingPointer?: boolean;
  followTarget?: { x: number; y: number } | null; spinSignal?: number;
  surface?: AvatarSurface; className?: string;
}
/** Dependency-injected React, shared by source and the verified native adapter. */
export function createPresenceCharacter(React: typeof ReactAPI) {
  const h = React.createElement;
  return React.forwardRef<PresenceCharacterHandle, PresenceCharacterProps>(function PresenceCharacter({ shape = "blob", color = "gray", state = "idle", paused = false, sizePx, sourceId, identityKey, emphasis, isFollowingPointer, followTarget, spinSignal = 0, surface = "auto", className }, ref) {
    const svg = React.useRef<SVGSVGElement>(null);
    const controller = React.useRef<AvatarMotionHandle | null>(null);
    const previousSignal = React.useRef(spinSignal);
    const presence = normalizePresence(state);
    const options: MotionOptions = { state: presence, paused, emphasis, following: isFollowingPointer, surface, identity: identityKey ?? sourceId };
    const latest = React.useRef(options); latest.current = options;
    const layers = React.useMemo(() => characterLayers(shape, color), [shape, color]);
    React.useEffect(() => {
      const node = svg.current;
      if (!node || paused) return;
      const handle = registerAvatarMotion(node, latest.current); controller.current = handle;
      return () => { handle.dispose(); if (controller.current === handle) controller.current = null; };
    }, [paused]);
    React.useEffect(() => { controller.current?.update(latest.current); }, [presence, paused, emphasis, isFollowingPointer, surface, identityKey, sourceId]);
    React.useEffect(() => { controller.current?.look(followTarget ?? null); }, [followTarget?.x, followTarget?.y, paused]);
    React.useEffect(() => {
      if (spinSignal === previousSignal.current) return;
      previousSignal.current = spinSignal; controller.current?.gesture("spin");
    }, [spinSignal]);
    React.useImperativeHandle(ref, () => {
      const play = (action: "spin" | "bounce" | "burst") => {
        if (controller.current) controller.current.gesture(action);
        else if (svg.current) gestureVisibleAvatar(svg.current.ownerDocument, latest.current.identity, action);
      };
      return { spin: () => play("spin"), bounce: () => play("bounce"), burst: () => play("burst") };
    }, []);
    const part = (name: AvatarPart) => layers.filter(layer => layer.part === name).map((layer, index) => h(layer.tag, { key: name + index, ...Object.fromEntries(Object.entries(layer.attrs).map(([key, value]) => [SVG_ATTRIBUTES[key] ?? key, value])) }));
    const dimension = sizePx == null ? undefined : Number.isFinite(sizePx) ? Math.max(1, Math.min(1024, sizePx)) : 32;
    return h("svg", { ref: svg, viewBox: "0 0 64 64", width: dimension, height: dimension, style: dimension == null ? undefined : { width: dimension, height: dimension }, className: ["bee-character", "presence-avatar", className].filter(Boolean).join(" "), "data-state": state, "data-presence": presence, "data-paused": paused, "data-motion": "off", "data-variant": characterVariant(shape), "aria-hidden": true, focusable: false },
      h("g", { id: sourceId },
        h("g", { "data-motion-part": "head" }, ...part("body"),
          h("g", { "data-motion-part": "gaze" }, ...part("detail"),
            h("g", { "data-motion-part": "expression" }, h("g", { "data-motion-part": "blink" }, ...part("eyes"))),
            h("g", { "data-motion-part": "mouth" }, ...part("mouth"))
          )
        )
      )
    );
  });
}
