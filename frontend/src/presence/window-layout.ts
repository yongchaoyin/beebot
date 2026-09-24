import { NATIVE_CAPTION_METRICS } from "../../../source/shared/window-layout.ts";

type Platform = keyof typeof NATIVE_CAPTION_METRICS;
type Layout = { platform: Platform; fullscreen: boolean };
type PriorStyle = { value: string; priority: string };
type LayoutSession = {
  owners: Map<object, Layout>;
  strip: HTMLElement;
  styles: Map<string, PriorStyle>;
  priorPlatform: string | null;
  priorFullscreen: string | null;
};
// The pinned renderer can evaluate a shared module more than once. Ownership is
// document-scoped, so closing a computer overlay cannot erase the main window's
// safe area. No MutationObserver, polling, focus changes, storage or IPC here.
const SESSION = Symbol.for("beebot.window-layout.v1");
const PROPERTIES = ["--bb-caption-block", "--bb-caption-leading", "--bb-caption-trailing"] as const;
type LayoutDocument = Document & { [SESSION]?: LayoutSession };

export function captionDimension(pixels: number): string {
  return `calc(${pixels}px / max(0.25, var(--sand-zoom-factor, 1)))`;
}

function refresh(document: Document, session: LayoutSession): void {
  const latest = [...session.owners.values()].at(-1);
  if (latest == null) return;
  const root = document.documentElement;
  const metrics = NATIVE_CAPTION_METRICS[latest.platform];
  root.dataset.bbWindowPlatform = latest.platform;
  root.dataset.bbWindowFullscreen = String(latest.fullscreen);
  for (const [index, key] of ["height", "leading", "trailing"].entries()) {
    const pixels = latest.fullscreen ? 0 : metrics[key as keyof typeof metrics];
    root.style.setProperty(PROPERTIES[index], captionDimension(pixels));
  }
  session.strip.hidden = latest.fullscreen;
}

/** Called from the real native window-state lifecycle, before React paints.
 * Unknown platforms (including plain web previews) never receive native chrome. */
export function installNativeWindowLayout(document: Document, platform: string, fullscreen: boolean): () => void {
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") return () => {};
  const doc = document as LayoutDocument;
  const root = document.documentElement;
  let session = doc[SESSION];
  if (session == null) {
    const strip = document.createElement("div");
    strip.id = "beebot-window-caption";
    strip.setAttribute("aria-hidden", "true");
    session = {
      owners: new Map(), strip,
      styles: new Map(PROPERTIES.map(key => [key, { value: root.style.getPropertyValue(key), priority: root.style.getPropertyPriority(key) }])),
      priorPlatform: root.getAttribute("data-bb-window-platform"),
      priorFullscreen: root.getAttribute("data-bb-window-fullscreen"),
    };
    document.body.appendChild(strip);
    doc[SESSION] = session;
  }
  const owner = {};
  session.owners.set(owner, { platform, fullscreen });
  refresh(document, session);
  return () => {
    if (!session.owners.delete(owner)) return;
    if (session.owners.size > 0) { refresh(document, session); return; }
    session.strip.remove();
    for (const [key, prior] of session.styles) {
      if (prior.value) root.style.setProperty(key, prior.value, prior.priority);
      else root.style.removeProperty(key);
    }
    for (const [key, prior] of [["data-bb-window-platform", session.priorPlatform], ["data-bb-window-fullscreen", session.priorFullscreen]] as const) {
      if (prior == null) root.removeAttribute(key); else root.setAttribute(key, prior);
    }
    delete doc[SESSION];
  };
}
