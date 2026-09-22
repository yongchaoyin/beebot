import type * as ReactAPI from "react";
import { characterVariant, characterLayers } from "./avatar-art";

export interface HoneylineCharacterHandle { spin(): void; bounce(): void; burst(): void }
export interface HoneylineCharacterProps {
  shape?: string;
  color?: string;
  state?: string;
  paused?: boolean;
  sizePx?: number;
  sourceId?: string;
  emphasis?: boolean;
  isFollowingPointer?: boolean;
  followTarget?: { x: number; y: number } | null;
  spinSignal?: number;
}
const REACT_ATTRS: Record<string, string> = { "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap" };
/** Inject the existing renderer React singleton; no second runtime is bundled. */
export function createHoneylineCharacter(React: typeof ReactAPI) {
  const h = React.createElement;
  return React.forwardRef<HoneylineCharacterHandle, HoneylineCharacterProps>(function HoneylineCharacter({ shape = "blob", color = "yellow", state = "idle", paused = false, sizePx, sourceId, spinSignal = 0 }, ref) {
    const svg = React.useRef<SVGSVGElement>(null);
    const animation = React.useRef<Animation | null>(null);
    const previousSignal = React.useRef(spinSignal);
    const pausedRef = React.useRef(paused);
    pausedRef.current = paused;
    React.useImperativeHandle(ref, () => {
      const play = (middle: string) => {
        animation.current?.cancel();
        const node = svg.current;
        if (!node || pausedRef.current || node.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        animation.current = node.animate?.([{ transform: "none" }, { transform: middle }, { transform: "none" }], { duration: 220, easing: "ease-out" }) ?? null;
      };
      return { spin: () => play("rotate(-8deg)"), bounce: () => play("translateY(-2px)"), burst: () => play("scale(1.06)") };
    }, []);
    React.useEffect(() => {
      if (paused) animation.current?.cancel();
      return () => { animation.current?.cancel(); animation.current = null; };
    }, [paused]);
    React.useEffect(() => {
      if (spinSignal === previousSignal.current) return;
      previousSignal.current = spinSignal;
      if (paused || svg.current?.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      animation.current?.cancel();
      animation.current = svg.current?.animate?.([{ transform: "none" }, { transform: "rotate(-8deg)" }, { transform: "none" }], { duration: 220 }) ?? null;
    }, [spinSignal, paused]);
    return h("svg", { ref: svg, viewBox: "0 0 64 64", width: sizePx, height: sizePx, className: "bee-character", "data-state": state, "data-paused": paused, "data-variant": characterVariant(shape), "aria-hidden": true, focusable: false },
      h("g", { id: sourceId }, ...characterLayers(shape, color).map((layer, index) => h(layer.tag, {
        key: index, ...Object.fromEntries(Object.entries(layer.attrs).map(([key, value]) => [REACT_ATTRS[key] ?? key, value])),
        ...(index === 2 || index === 3 ? { className: "bee-character__eyes" } : {}),
      }))));
  });
}
