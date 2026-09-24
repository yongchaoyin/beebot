// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L520
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { DesktopBridge } from "../../../contracts/desktop-bridge";
import type { TranscriptComputerHandoff } from "../../conversation/workspace/model";
import type { ComputerExperience, ComputerHandoffCardProjection } from "./controller";
import {
  DIRECT_MONITOR_LIMIT,
  VNC_FOCUS_DELAY_MS,
  VNC_WARM_PREVIEW_LIMIT,
  computerCursorPresentation,
  computerStageCopy,
  firstSelectedMonitor,
  handoffStatusLabel,
  retainWarmVncSources,
  stepSelectedMonitor,
  vncDimensions,
  type ComputerHandoff,
  type ComputerCursor,
  type ComputerMonitor,
  type ComputerStageCopy,
  type ComputerStatusProjection
} from "./model";
import { isVncWebviewReady, VncWebview, type VncWebviewElement } from "./vnc-webview";
import { TeachRecordingFrame, TeachRecordingPreviewFrame, TeachRecordingPreviewPeerRow, TeachRecordingStoreView, TeachRecordingTopBar } from "../teach-recording/view";
import type { TeachRecordingComputerInjection } from "../teach-recording/composition";
import { SandIconButton } from "../../../ui/sand-kit-primitives";
import "./view.css";

const DETAILS_ID = "sand-conversation-details";
const COMPUTER_HEADER_LABELS = {
  active: "BeeBot's Computer, in use",
  idle: "BeeBot's Computer"
};
const KIT_BUTTON_BASE = "sand-kit-button sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-1jnr06f sand-2lah0s sand-9f619 sand-c342km sand-ng3xce sand-jb2p0i sand-uxw1ft sand-1ypdohk sand-tgyt42 sand-s2xxs2 sand-gdialr sand-9lcvmn sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-4sht9k sand-1y3gkto";
const KIT_BUTTON_SM = `${KIT_BUTTON_BASE} sand-fifm61 sand-1d3mw78 sand-12oo3zp sand-1iorvi4 sand-1ug7bdz sand-jkvuk6 sand-11iknt3 sand-1kogg8i`;
const KIT_BUTTON_SECONDARY = `${KIT_BUTTON_SM} sand-1tiofj7 sand-ex9vrg sand-wj1584 sand-tyxrsu sand-g7klql`;
const KIT_BUTTON_PRIMARY = `${KIT_BUTTON_SM} sand-1wclgxm sand-1e15362 sand-1gzh0bn sand-xcaa6e sand-g7klql`;
const BANNER_BUTTON_SECONDARY = `${KIT_BUTTON_SECONDARY} sand-6r4lm7 sand-y5l4bz sand-j04kma sand-5a26a2`;
const BANNER_BUTTON_PRIMARY = `${KIT_BUTTON_PRIMARY} sand-3wg7rn sand-1kc055u sand-b78v21`;
const RETRY_BUTTON = `${KIT_BUTTON_SECONDARY} sand-y13l1i sand-163pfp sand-149ho13 sand-67bb7w`;
const ASK_BUTTON_BASE = "sand-button sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-17d4w8g sand-178xt8z sand-s1s249 sand-so031l sand-e0pwq sand-13fuv20 sand-32b0ac sand-1q0q8m5 sand-19ypqd9 sand-1v8p93f sand-he5wa1 sand-16stqrj sand-1g4hjc sand-jb2p0i sand-1k6tqyu sand-uxw1ft sand-2b8uid sand-krqix3 sand-87ps6o sand-ggy1nq sand-1ypdohk sand-1s07b3s sand-1hc1fzr sand-uhm2yv sand-67bb7w sand-aqnwrm sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-1uczgqu sand-1725o6r sand-1wfwxd8 sand-7s97pk sand-1eaenvl sand-bb3pvg sand-1pbvl4h sand-10w6t97 sand-ur7f20 sand-cicffo sand-1lqa7cf sand-fc7y3v sand-1yxxptd";
const ASK_BUTTON_PRIMARY = `${ASK_BUTTON_BASE} sand-1gxx7xa sand-1y49cd9 sand-70xvah sand-mak4db sand-1qd9jm1 sand-1tc92z3`;
const ASK_BUTTON_OUTLINE = `${ASK_BUTTON_BASE} sand-jbqb8w sand-pp4zd3 sand-1wd3ewq sand-2kampu sand-hnkhp4 sand-1jfuf7k sand-1l09f48 sand-qz0629 sand-1ciwos8 sand-oli092`;
const ASK_BUTTON_TEXT = `${ASK_BUTTON_BASE} sand-jbqb8w sand-19aaqeu sand-1dsx48b sand-4b2ntj sand-1abnqxm sand-8x9d4c sand-1xpa7k sand-1uhho1l sand-n5hx6u`;
const ICON_BUTTON_SM = "sand-kit-icon-button sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-9f619 sand-exx8yu sand-1xpa7k sand-18d9i69 sand-1uhho1l sand-c342km sand-ng3xce sand-jbqb8w sand-1ypdohk sand-tgyt42 sand-s2xxs2 sand-gdialr sand-9lcvmn sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-4sht9k sand-1y3gkto sand-vy4d1p sand-xk0z11 sand-1kogg8i sand-1r8pydn sand-1o0liin sand-1fx2joi sand-7n8uir sand-99e291 sand-1v0sr2s";
const ICON_BUTTON_MD = "sand-kit-icon-button sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-9f619 sand-exx8yu sand-1xpa7k sand-18d9i69 sand-1uhho1l sand-c342km sand-ng3xce sand-jbqb8w sand-1ypdohk sand-tgyt42 sand-s2xxs2 sand-gdialr sand-9lcvmn sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-4sht9k sand-1y3gkto sand-gd8bvy sand-1fgtraw sand-1kogg8i sand-1r8pydn sand-1o0liin sand-1fx2joi sand-7n8uir";
const KIT_ICON_MD = "sand-kit-icon sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-1heor9g sand-1xp8n7a sand-mix8c7";
const INFO_PANE_TOP = "sand-info-pane__top sand-1n2onr6 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-lvsv26 sand-xlogw sand-14kp3v7 sand-exx8yu sand-j9b1aj sand-18d9i69 sand-f18ygs";
const INFO_PANE_ACTIONS = "sand-info-pane__actions sand-3nfvp2 sand-6s0dn4 sand-195vfkc sand-lvsv26";
const PREVIEW_FIT_PROPERTY = "--sand-computer-preview-fit";
const INFO_PANE_MIN_WIDTH = 280;
const INFO_PANE_MAX_WIDTH = 480;
const INFO_PANE_COLLAPSE_WIDTH = 244;
const INFO_PANE_CHAT_MIN_WIDTH = 424;
const INFO_PANE_WINDOW_CONTROL_WIDTH = 140;
const INFO_PANE_CLOSE_LINGER_MS = 240;
const TEXT_BASE = "ui-text ui-1acoasx ui-dj266r ui-1yf7rl7 ui-at24cr ui-j3b58b ui-exx8yu ui-1xpa7k ui-18d9i69 ui-1uhho1l ui-vmahel ui-lh3980";
const TYPOGRAPHY_SIZE = {
  sm: "ui-1wm8ruf ui-spwq11 ui-14s4slr",
  md: "ui-11wthnw ui-1ja60sm ui-vu1jfw",
  lg: "ui-fc7y3v ui-1yxxptd ui-1bignsj"
};
const TEXT_WEIGHT = { regular: "ui-20ajya", medium: "ui-1yl5bsf" };
const TEXT_COLOR = { yellow: "ui-1izesbo", secondary: "ui-19aaqeu", tertiary: "ui-4b2ntj" };

function UiText({ children, className = "", color, id, size = "md", weight = "regular" }: {
  children: ReactNode;
  className?: string;
  color?: keyof typeof TEXT_COLOR;
  id?: string;
  size?: keyof typeof TYPOGRAPHY_SIZE;
  weight?: keyof typeof TEXT_WEIGHT;
}) {
  return <span
    className={`${TEXT_BASE} ${TYPOGRAPHY_SIZE[size]} ${TEXT_WEIGHT[weight]}${color == null ? "" : ` ${TEXT_COLOR[color]}`}${className.length === 0 ? "" : ` ${className}`}`}
    data-color={color}
    data-size={size}
    data-variant="default"
    data-weight={weight}
    id={id}
  >{children}</span>;
}

function UiLoadingIcon() {
  const style = { "--cursor-icon-content": `"${String.fromCodePoint(0xedca)}"` } as CSSProperties;
  return <i
    aria-hidden="true"
    className="ui-icon ui-1j61x8r ui-etm3q0 ui-1tachi3 ui-1qt6sjn ui-o5v014 ui-3nfvp2 ui-6s0dn4 ui-l56j7k ui-1heor9g ui-1oai4fc ui-higkf7 ui-xymvpz ui-krqix3 ui-1403hyl ui-2b8uid ui-6mezaz ui-vmahel ui-lh3980 ui-87ps6o ui-1winvzj ui-1u4itkb ui-1q5xvfy ui-1ehclkv ui-1yj7g93 ui-1hn9r2r ui-138fvbv ui-lmf4m6 ui-1esw782 ui-a4qsjk cursor-icon sand-2lah0s"
    data-color="yellow"
    data-icon-name="loading"
    data-size="sm"
    style={style}
  />;
}

function setInfoPaneWidth(width: number) {
  document.querySelector<HTMLElement>(".sand-shell")?.style.setProperty("--sand-info-pane-width", `${width}px`);
}

export function createCloseLingerStore(delayMs: number) {
  let hidden = false;
  return {
    subscribeFor(shouldHide: boolean) {
      return (notify: () => void) => {
        hidden = false;
        if (!shouldHide) return () => {};
        const timeout = window.setTimeout(() => {
          hidden = true;
          notify();
        }, delayMs);
        return () => {
          window.clearTimeout(timeout);
          hidden = false;
        };
      };
    },
    read: () => hidden
  };
}

function useInfoPaneCloseLinger(isOpen: boolean) {
  const store = useRef<ReturnType<typeof createCloseLingerStore> | null>(null);
  if (store.current == null) store.current = createCloseLingerStore(INFO_PANE_CLOSE_LINGER_MS);
  const subscribe = useMemo(() => store.current!.subscribeFor(!isOpen), [isOpen]);
  const isLingered = useSyncExternalStore(subscribe, store.current.read, store.current.read);
  return !isOpen && isLingered;
}

export function projectInfoPaneResize(input: { pointerWidth: number; zoomExcess: number; maxWidth: number }): { isCollapse: true } | { isCollapse: false; width: number } {
  const effectiveWidth = input.pointerWidth - input.zoomExcess;
  if (effectiveWidth < INFO_PANE_COLLAPSE_WIDTH) return { isCollapse: true };
  const maxWidth = Math.max(INFO_PANE_MIN_WIDTH, Math.min(INFO_PANE_MAX_WIDTH, input.maxWidth));
  return { isCollapse: false, width: Math.max(INFO_PANE_MIN_WIDTH, Math.min(maxWidth, effectiveWidth)) };
}

function zoomExcess(hasWindowControls: boolean) {
  if (!hasWindowControls) return 0;
  const zoom = Number.parseFloat(document.documentElement.style.getPropertyValue("--sand-zoom-factor"));
  return !Number.isFinite(zoom) || zoom <= 0 ? 0 : Math.max(0, INFO_PANE_WINDOW_CONTROL_WIDTH / zoom - INFO_PANE_WINDOW_CONTROL_WIDTH);
}

function useInfoPaneResize(bridge: DesktopBridge, onClose: () => void) {
  const width = useRef(320);
  const collapsed = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (stop.current != null) return;
    const parent = event.currentTarget.parentElement;
    if (parent == null) return;
    event.preventDefault();
    const edge = parent.getBoundingClientRect().right;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    element.setPointerCapture(pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const sidebarWidth = document.querySelector<HTMLElement>(".sand-agents-sidebar")?.getBoundingClientRect().width ?? INFO_PANE_MIN_WIDTH;
      const projection = projectInfoPaneResize({
        pointerWidth: edge - pointer.clientX,
        zoomExcess: zoomExcess(bridge.platform !== "darwin" && bridge.platform !== "win32"),
        maxWidth: window.innerWidth - INFO_PANE_CHAT_MIN_WIDTH - sidebarWidth
      });
      if (projection.isCollapse) {
        collapsed.current = true;
        setInfoPaneWidth(INFO_PANE_MIN_WIDTH);
        return;
      }
      collapsed.current = false;
      width.current = projection.width;
      setInfoPaneWidth(width.current);
    };
    const end = () => {
      if (stop.current !== end) return;
      stop.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      window.removeEventListener("keydown", keydown);
      element.removeEventListener("lostpointercapture", end);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (collapsed.current) {
        collapsed.current = false;
        setInfoPaneWidth(width.current);
        onClose();
      }
    };
    const keydown = (key: KeyboardEvent) => { if (key.key === "Escape") end(); };
    stop.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    window.addEventListener("keydown", keydown);
    element.addEventListener("lostpointercapture", end);
  }, [bridge.platform, onClose]);
}

function DeviceDesktopIcon({ size = "sm" }: { size?: "sm" | "base" | "xl" }) {
  return <span aria-hidden="true" data-size={size} style={{ fontFamily: "cursor-icons" }}>{String.fromCodePoint(0xea7a)}</span>;
}

function ExpandIcon() {
  return <span aria-hidden="true" style={{ fontFamily: "cursor-icons" }}>{String.fromCodePoint(0xf2cf)}</span>;
}

function ContractIcon() {
  return <span aria-hidden="true" style={{ fontFamily: "cursor-icons" }}>{String.fromCodePoint(0xf2cd)}</span>;
}

function MediumKitIcon({ codePoint }: { codePoint: number }) {
  return <span aria-hidden="true" className={KIT_ICON_MD} data-size="md"><span style={{ fontFamily: "cursor-icons", fontSize: 14 }}>{String.fromCodePoint(codePoint)}</span></span>;
}

export function bindVncPreviewFit(element: HTMLElement | null, framebuffer: { width: number; height: number }): (() => void) | undefined {
  if (element == null) return;
  let previous: string | null = null;
  const measure = () => {
    const bounds = element.getBoundingClientRect();
    const scale = bounds.width <= 0 || bounds.height <= 0 ? 0 : Math.min(bounds.width / framebuffer.width, bounds.height / framebuffer.height);
    const value = String(scale);
    if (value !== previous) {
      previous = value;
      element.style.setProperty(PREVIEW_FIT_PROPERTY, value);
    }
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  return () => {
    observer.disconnect();
    element.style.removeProperty(PREVIEW_FIT_PROPERTY);
  };
}

function StagePlaceholder({ copy, tone, onRetry }: { copy: ComputerStageCopy; tone: "cover" | "pane"; onRetry(): void }) {
  const cover = tone === "cover";
  return <div className={`sand-computer-stage__placeholder ${cover
    ? "sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-l56j7k sand-1v2ro7d sand-193iq5w sand-ggk2y7 sand-2b8uid sand-fungia"
    : "sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-l56j7k sand-193iq5w sand-2b8uid sand-167g77z sand-c7ga6q sand-19aaqeu"}`}>
    <span className="sand-4z9k3i sand-d4r4e8 sand-12oo3zp">{copy.message}</span>
    {copy.isBusy ? <span className="sand-78zum5 sand-6s0dn4 sand-167g77z sand-weiyed sand-193iq5w">
      <span aria-hidden="true" className="sand-1n2onr6 sand-1iyjqo2 sand-s83m0k sand-euugli sand-ols6we sand-149ho13 sand-b3r6kr sand-n5dbpy">
        <span className={copy.progressPercent == null
          ? "sand-10l6tqk sand-13vifvy sand-1ey2m1c sand-u96u03 sand-149ho13 sand-twfq29 sand-xljpkc sand-9q055v sand-1aquc0h sand-1sbju2s sand-4hg4is sand-a4qsjk"
          : "sand-10l6tqk sand-13vifvy sand-1ey2m1c sand-u96u03 sand-149ho13 sand-twfq29"}
          style={copy.progressPercent == null ? undefined : { width: `${Math.max(0, Math.min(copy.progressPercent, 100))}%` }} />
      </span>
      {copy.progressPercent == null ? null : <span className="sand-4z9k3i sand-d4r4e8 sand-12oo3zp">{Math.round(copy.progressPercent)}%</span>}
    </span> : null}
    {copy.hasRetry ? <button className={`${RETRY_BUTTON}${cover ? " sand-6r4lm7 sand-y5l4bz sand-j04kma sand-5a26a2" : ""}`} data-sentiment="neutral" data-shape="pill" data-size="sm" data-variant="secondary" onClick={onRetry} type="button"><span className="sand-euugli sand-b3r6kr sand-lyipyv">Retry</span></button> : null}
  </div>;
}

function LoadingSpinner({ size = 20, borderWidth = 2 }: { size?: number; borderWidth?: number }) {
  return <span aria-hidden="true" className="sand-16rqkct sand-1y0btm7 sand-zewv6b sand-4usyfx sand-1so62im sand-r5sbw0 sand-1aquc0h sand-of6966 sand-1esw782 sand-a4qsjk sand-1hc1fzr sand-11gebw9" style={{ width: size, height: size, borderWidth }} />;
}

function VncPool({ bridge, src, className, maxWarm = VNC_WARM_PREVIEW_LIMIT }: {
  bridge: DesktopBridge;
  src: string | null;
  className?: string;
  maxWarm?: number;
}) {
  const [warm, setWarm] = useState<string[]>(() => src == null ? [] : [src]);
  const [connected, setConnected] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const nextWarm = retainWarmVncSources(warm, src, maxWarm);
  if (nextWarm.length !== warm.length || nextWarm.some((value, index) => value !== warm[index])) setWarm(nextWarm);
  const connecting = src != null && !connected && !crashed;
  return <div className="sand-box-vnc-pool sand-10l6tqk sand-10a8y8t">
    {warm.map((value) => {
      const current = value === src;
      const visible = current && !connecting && !crashed;
      const dimensions = vncDimensions(value);
      return <div
        aria-hidden={!current}
        className={`sand-box-vnc-pool__layer sand-10l6tqk sand-wa60dl sand-1nrll8i sand-1g0ag68 sand-18a52ng${visible ? "" : " sand-lshs6z sand-47corl"}`}
        key={value}
        style={{ width: dimensions.width, height: dimensions.height, marginTop: -dimensions.height / 2, marginLeft: -dimensions.width / 2 }}
      ><VncWebview
        bridge={bridge}
        className={className}
        onConnectedChange={current ? setConnected : undefined}
        onCrashedChange={current ? setCrashed : undefined}
        src={value}
      /></div>;
    })}
    {connecting ? <span className="sand-box-vnc-pool__connecting sand-10l6tqk sand-10a8y8t sand-78zum5 sand-6s0dn4 sand-l56j7k sand-47corl"><LoadingSpinner size={20} /></span> : null}
    {src != null && crashed ? <span className="sand-box-vnc-pool__crashed sand-10l6tqk sand-10a8y8t sand-78zum5 sand-6s0dn4 sand-l56j7k sand-47corl sand-fifm61 sand-1d3mw78 sand-12oo3zp">Screen preview unavailable</span> : null}
  </div>;
}

function MonitorThumb({ bridge, monitor, onFocus }: { bridge: DesktopBridge; monitor: ComputerMonitor; onFocus(id: string): void }) {
  const needsAttention = monitor.handoff != null;
  const label = needsAttention ? `${monitor.title} — needs you` : `Switch to ${monitor.title}`;
  const dimensions = vncDimensions(monitor.vncUrl);
  return <button aria-label={label} className="sand-computer-monitor-strip__thumb sand-78zum5 sand-dt5ytf sand-17d4w8g sand-ykynuu sand-s83m0k sand-euugli sand-18qnofl sand-1717udv sand-1ghz6dp sand-ng3xce sand-jbqb8w sand-jyslct sand-1lugfcp sand-jb2p0i sand-1ypdohk sand-1t137rt sand-9v5kkp sand-1k57tk5 sand-784prv sand-1uczgqu sand-1725o6r sand-1wfwxd8 sand-7s97pk" onClick={() => onFocus(monitor.subagentId)} title={label} type="button">
    <span className="sand-1n2onr6 sand-h8yej3 sand-ur7f20 sand-b3r6kr sand-1ua6jya sand-78zum5 sand-6s0dn4 sand-l56j7k sand-4b2ntj sand-j04kma" style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
      <span className="sand-10l6tqk sand-10a8y8t sand-47corl"><VncWebview bridge={bridge} src={monitor.vncUrl} /></span>
      <span aria-hidden="true" className="sand-10l6tqk sand-10a8y8t sand-htitgo" />
    </span>
    <span className="sand-78zum5 sand-6s0dn4 sand-l56j7k sand-1jnr06f sand-h8yej3 sand-euugli">
      {needsAttention ? <span aria-hidden="true" className="sand-2lah0s sand-1v4s8kt sand-ols6we sand-149ho13 sand-10j2od" /> : null}
      <span className="sand-fifm61 sand-1d3mw78 sand-12oo3zp sand-euugli sand-b3r6kr sand-lyipyv sand-uxw1ft sand-2b8uid sand-102cea3">{monitor.title}</span>
    </span>
  </button>;
}

function MonitorStrip({ bridge, monitors, onFocus }: { bridge: DesktopBridge; monitors: readonly ComputerMonitor[]; onFocus(id: string): void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuRoot = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const overflows = monitors.length > DIRECT_MONITOR_LIMIT + 1;
  const direct = overflows ? monitors.slice(0, DIRECT_MONITOR_LIMIT) : monitors;
  const overflow = overflows ? monitors.slice(DIRECT_MONITOR_LIMIT) : [];
  const focusMenuItem = (index: number) => itemRefs.current[(index + overflow.length) % overflow.length]?.focus();
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") { event.preventDefault(); focusMenuItem(current + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusMenuItem(current - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusMenuItem(0); }
    else if (event.key === "End") { event.preventDefault(); focusMenuItem(overflow.length - 1); }
    else if (event.key === "Escape") { event.preventDefault(); setMoreOpen(false); trigger.current?.focus(); }
  };
  useEffect(() => { if (moreOpen) itemRefs.current[0]?.focus(); }, [moreOpen]);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRoot.current?.contains(event.target)) setMoreOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside, true);
    return () => window.removeEventListener("pointerdown", closeOutside, true);
  }, [moreOpen]);
  if (monitors.length === 0) return null;
  return <div className="sand-computer-monitor-strip sand-78zum5 sand-1cy8zhl sand-l56j7k sand-167g77z sand-2lah0s sand-h8yej3 sand-euugli sand-ch40qd sand-14vqqas" role="group">
    {direct.map((monitor) => <MonitorThumb bridge={bridge} key={monitor.subagentId} monitor={monitor} onFocus={onFocus} />)}
    {overflow.length === 0 ? null : <span className="sand-1n2onr6" ref={menuRoot}>
      <button
        aria-expanded={moreOpen}
        aria-haspopup="menu"
        aria-label={`Show ${overflow.length} more screens`}
        className="sand-computer-monitor-strip__more sand-78zum5 sand-dt5ytf sand-17d4w8g sand-ykynuu sand-s83m0k sand-euugli sand-18qnofl sand-1717udv sand-1ghz6dp sand-ng3xce sand-jbqb8w sand-jyslct sand-1lugfcp sand-jb2p0i sand-1ypdohk sand-1t137rt sand-9v5kkp sand-1k57tk5 sand-784prv sand-1uczgqu sand-1725o6r sand-1wfwxd8 sand-7s97pk"
        onClick={() => setMoreOpen((open) => !open)}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMoreOpen(true); } }}
        ref={trigger}
        title={`${overflow.length} more screens`}
        type="button"
      >
        <span className="sand-1n2onr6 sand-h8yej3 sand-ur7f20 sand-b3r6kr sand-78zum5 sand-6s0dn4 sand-l56j7k sand-j04kma sand-6r4lm7 sand-p7q3dj"><DeviceDesktopIcon size="xl" /></span>
        <span className="sand-78zum5 sand-6s0dn4 sand-l56j7k sand-1jnr06f sand-h8yej3 sand-euugli">{overflow.some((monitor) => monitor.handoff != null) ? <span aria-hidden="true" className="sand-2lah0s sand-1v4s8kt sand-ols6we sand-149ho13 sand-10j2od" /> : null}<span className="sand-fifm61 sand-1d3mw78 sand-12oo3zp sand-euugli sand-b3r6kr sand-lyipyv sand-uxw1ft sand-2b8uid sand-102cea3">and {overflow.length} more</span></span>
      </button>
      {/* @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4816770 (shipped popup bounds) */}
      {moreOpen ? <div aria-label="More screens" className="sand-9f619 sand-78zum5 sand-dt5ytf sand-1cvmir6 sand-1usz39j sand-vvtkfd sand-4hv7ue sand-1y0btm7 sand-fnq37j sand-4pepcl sand-yb0u61 sand-b3r6kr" onKeyDown={onMenuKeyDown} role="menu" style={{ maxHeight: 320, minWidth: 240 }}>
        {overflow.map((monitor, index) => <button className="sand-mention-menu-item sand-9f619 sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-h8yej3 sand-1fgtraw sand-1yrsyyn sand-y13l1i sand-10b6aqq sand-163pfp sand-ng3xce sand-1kogg8i sand-jbqb8w sand-tyxrsu sand-jb2p0i sand-dpxx8g sand-1ypdohk sand-euugli sand-1t137rt" key={monitor.subagentId} onClick={() => { onFocus(monitor.subagentId); setMoreOpen(false); }} ref={(element) => { itemRefs.current[index] = element; }} role="menuitem" type="button">{monitor.title}{monitor.handoff == null ? null : <span aria-hidden="true" className="sand-3nfvp2 sand-6s0dn4 sand-2lah0s sand-1v4s8kt sand-ols6we sand-149ho13 sand-10j2od" />}</button>)}
      </div> : null}
    </span>}
  </div>;
}

function HandoffBanner({ handoff, subjectLabel, onDismiss, onHandBack }: { handoff: ComputerHandoff; subjectLabel: string; onDismiss(): void; onHandBack(): void }) {
  const instruction = handoff.instruction.trim();
  return <div className="sand-computer-banner sand-9f619 sand-78zum5 sand-6s0dn4 sand-ou54vl sand-2lah0s sand-h8yej3 sand-1e56ztr sand-889kno sand-cicffo sand-1a8lsjc sand-f18ygs sand-1q4ynmn sand-v1id1i">
    <span className="sand-computer-banner__body sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-1iyjqo2 sand-s83m0k sand-euugli sand-104kibb sand-1ua5tub sand-1h7i4cw sand-j0a0fe sand-10wlt62 sand-n0e0ga" title={handoff.instruction}>{instruction.length > 0 ? instruction : `${subjectLabel} needs you`}</span>
    <span className="sand-78zum5 sand-6s0dn4 sand-167g77z sand-2lah0s"><button className={BANNER_BUTTON_SECONDARY} data-sentiment="neutral" data-shape="rectangular" data-size="sm" data-variant="secondary" onClick={onDismiss} type="button"><span className="sand-euugli sand-b3r6kr sand-lyipyv">Skip this step</span></button><button className={BANNER_BUTTON_PRIMARY} data-sentiment="neutral" data-shape="rectangular" data-size="sm" data-variant="primary" onClick={onHandBack} type="button"><span className="sand-euugli sand-b3r6kr sand-lyipyv">I'm done, continue</span></button></span>
  </div>;
}

const CURSOR_PATH = "M2.002 9.538c-.023.411.207.794.581.966l7.504 3.442 3.442 7.503c.164.356.52.583.909.583l.057-.002a1 1 0 0 0 .894-.686l5.595-17.032c.117-.358.023-.753-.243-1.02s-.66-.358-1.02-.243L2.688 8.645a.997.997 0 0 0-.686.893z";

function ComputerCursorOverlay({ cursor, framebuffer }: { cursor: ComputerCursor | null; framebuffer: { width: number; height: number } }) {
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const attach = useCallback((element: HTMLDivElement | null) => {
    if (element == null) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setFrame({ width: bounds.width, height: bounds.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const presentation = computerCursorPresentation(cursor, frame != null);
  const scale = frame == null ? 1 : Math.min(1.8, Math.max(.75, frame.width / framebuffer.width * 2.85));
  const x = cursor != null && frame != null ? cursor.x / framebuffer.width * frame.width : 0;
  const y = cursor != null && frame != null ? cursor.y / framebuffer.height * frame.height : 0;
  const cursorClass = `sand-computer-cursor sand-10l6tqk sand-13vifvy sand-u96u03${presentation.isVisible ? "" : " sand-g01cxk"} sand-1hj3fc7 sand-1q1rmc8${presentation.isGliding ? " sand-u4a3u5 sand-nyiixm" : " sand-pzuper"}${presentation.isVisible ? " sand-1hc1fzr" : ""}`;
  const press = presentation.press;
  return <div aria-hidden="true" className="sand-computer-cursor-overlay sand-10l6tqk sand-10a8y8t sand-b3r6kr sand-47corl sand-1u8a7rm" ref={attach}>
    <span className={cursorClass} style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}>
      <svg className={`sand-computer-cursor-glyph sand-10l6tqk sand-wc5g4n sand-1ct5tfr sand-1lliihq sand-vy4d1p sand-xk0z11 sand-55qf4y sand-fs3179${press == null ? "" : " sand-18imfhs sand-1aquc0h sand-b8lv0f sand-1u6ievf"}`} fill="none" key={press?.key ?? "rest"} style={press == null ? undefined : { animationDelay: `${press.delayMs}ms` }} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d={CURSOR_PATH} fill="white" stroke="white" strokeLinejoin="round" strokeWidth="1.5" /><path d={CURSOR_PATH} fill="black" /></svg>
    </span>
  </div>;
}

export function ComputerFullscreen({ bridge, experience, subjectLabel, onRequestComposerFocus, teachRecording }: { bridge: DesktopBridge; experience: ComputerExperience; subjectLabel: string; onRequestComposerFocus(): void; teachRecording?: TeachRecordingComputerInjection }) {
  const { isOpen, monitors, view } = experience;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  let selected = firstSelectedMonitor(monitors, selectedId);
  if (isOpen && experience.focusMonitorId != null && experience.focusMonitorId !== focusedId) {
    setFocusedId(experience.focusMonitorId);
    selected = firstSelectedMonitor(monitors, experience.focusMonitorId);
  } else if (!isOpen && focusedId != null) setFocusedId(null);
  if (selected !== selectedId) setSelectedId(selected);
  const current = monitors.find((monitor) => monitor.subagentId === selected) ?? null;
  const otherMonitors = monitors.filter((monitor) => monitor.subagentId !== current?.subagentId);
  const hasMonitors = monitors.length > 0;
  const setupVnc = !hasMonitors ? view.vncUrl : null;
  const stageKey = current?.subagentId ?? (setupVnc == null ? null : "setup");
  const stageVnc = current?.vncUrl ?? setupVnc;
  const handoff = current?.handoff ?? view.handoff;
  const dimensions = vncDimensions(stageVnc ?? "");
  const copy = computerStageCopy({
    isScreenLoading: !hasMonitors && !view.isStatusKnown && !view.isStatusUnavailable,
    isScreenUnavailable: !hasMonitors && view.isStatusUnavailable,
    subjectLabel,
    ...(view.phase === "local" ? { emptyMessage: "This agent runs on your machine. There's no separate desktop to stream." } : {}),
    isEmptyLoading: view.phase !== "local",
    pullPercent: hasMonitors ? null : view.pullPercent
  });
  const regionRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<VncWebviewElement>(null);
  const [ready, setReady] = useState(false);
  const [focusedStage, setFocusedStage] = useState<string | null>(null);
  if (!isOpen && focusedStage != null) setFocusedStage(null);
  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4832596 (onReadyChange clears focus after VNC loss)
  const onReadyChange = useCallback((value: boolean) => {
    setReady(value);
    if (!value) setFocusedStage(null);
  }, []);
  const step = useCallback((delta: -1 | 1) => setSelectedId((value) => stepSelectedMonitor(monitors, value, delta)), [monitors]);
  const onArrow = useCallback((key: string, preventDefault?: () => void) => {
    if (monitors.length < 2) return;
    if (key === "ArrowDown" || key === "ArrowRight") { preventDefault?.(); step(1); }
    else if (key === "ArrowUp" || key === "ArrowLeft") { preventDefault?.(); step(-1); }
  }, [monitors.length, step]);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => onArrow(event.key, () => event.preventDefault());
    window.addEventListener("keydown", onKeyDown);
    regionRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onArrow]);
  useEffect(() => {
    if (!isOpen || !ready || stageKey == null || focusedStage === stageKey || webviewRef.current == null || !isVncWebviewReady(webviewRef.current)) return;
    webviewRef.current.focus();
    setFocusedStage(stageKey);
    const timeout = window.setTimeout(() => {
      const element = webviewRef.current;
      if (element == null || !element.isConnected || !isVncWebviewReady(element)) return;
      element.focus();
      let vncHost: string | undefined;
      try { vncHost = new URL(element.getAttribute("src") ?? "").host; } catch {}
      bridge.telemetry.reportVncSession({ surface: "interactive", phase: "focus", ...(vncHost == null ? {} : { vncHost }), focusOwner: "vnc", focusLanded: document.activeElement === element });
    }, VNC_FOCUS_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [bridge, focusedStage, isOpen, ready, stageKey]);
  const close = teachRecording?.onCloseFullscreen ?? (() => { experience.close(); onRequestComposerFocus(); });
  const handBack = (trigger: "button" | "dismissed") => {
    const id = current?.handoff != null ? current.subagentId : null;
    void experience.handBack(id, trigger);
    close();
  };
  return <div aria-label={`${subjectLabel}'s screen`} className={isOpen
    ? "sand-computer-fullscreen sand-ixxii4 sand-10a8y8t sand-f5e64p sand-78zum5 sand-dt5ytf sand-14gmceu sand-1t137rt"
    : "sand-computer-fullscreen sand-ixxii4 sand-10a8y8t sand-f5e64p sand-78zum5 sand-dt5ytf sand-14gmceu sand-1t137rt sand-lshs6z sand-47corl"} ref={regionRef} role="region" tabIndex={-1}>
    {teachRecording == null ? <div className="sand-computer-top-bar sand-1n2onr6 sand-9f619 sand-78zum5 sand-6s0dn4 sand-167g77z sand-2lah0s sand-h8yej3 sand-n3w4p2 sand-163pfp sand-lkep63 sand-8qq8ib">
      <span aria-hidden="true" className="sand-1iyjqo2 sand-s83m0k sand-kh2ocl sand-euugli sand-avu8j0 sand-1wfn6di" />
      <div className="sand-computer-top-bar__actions sand-78zum5 sand-6s0dn4 sand-167g77z sand-2lah0s sand-lvsv26 sand-482pwi"><button aria-label="Exit fullscreen" className={ICON_BUTTON_SM} data-size="sm" data-variant="ghost" onClick={close} title="Exit fullscreen" type="button"><ContractIcon /></button></div>
    </div> : <TeachRecordingTopBar {...teachRecording.topBar} />}
    <div className="sand-computer-body sand-9f619 sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-l56j7k sand-1iyjqo2 sand-s83m0k sand-2lwn1j sand-h8yej3 sand-e8ttls">
      {handoff == null ? null : <HandoffBanner handoff={handoff} onDismiss={() => handBack("dismissed")} onHandBack={() => handBack("button")} subjectLabel={subjectLabel} />}
      {teachRecording == null ? null : <TeachRecordingFrame {...teachRecording.frame} />}
      <div className="sand-computer-stage sand-1n2onr6 sand-h8yej3 sand-1iyjqo2 sand-s83m0k sand-2lwn1j sand-78zum5 sand-6s0dn4 sand-l56j7k sand-pqogu8">
        {stageKey != null && stageVnc != null ? <div className="sand-computer-stage__frame sand-1n2onr6 sand-78zum5 sand-6s0dn4 sand-l56j7k sand-b3r6kr sand-t9pb60 sand-1ua6jya sand-j04kma" style={{ width: `min(100cqw, calc(100cqh * ${dimensions.width} / ${dimensions.height}))`, aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
          <div className="sand-10l6tqk sand-10a8y8t"><VncWebview bridge={bridge} isInteractive isViewerVisible={isOpen} key={`${stageKey}:${stageVnc}`} onHostKey={(key) => onArrow(key)} onReadyChange={onReadyChange} openedAtMs={experience.openedAtMs} ref={webviewRef} src={stageVnc} /></div>
        </div> : <StagePlaceholder copy={copy} onRetry={experience.refresh} tone="cover" />}
      </div>
      {teachRecording == null ? null : <TeachRecordingStoreView {...teachRecording.storeView} />}
      {current == null ? null : <div className="sand-78zum5 sand-6s0dn4 sand-l56j7k sand-1jnr06f sand-2lah0s sand-h8yej3 sand-euugli sand-1k70j0n"><span className="sand-fifm61 sand-1d3mw78 sand-12oo3zp sand-euugli sand-b3r6kr sand-lyipyv sand-uxw1ft sand-2b8uid sand-102cea3">{current.title}</span></div>}
      <MonitorStrip bridge={bridge} monitors={otherMonitors} onFocus={setSelectedId} />
    </div>
  </div>;
}

export function ComputerPreview({ bridge, experience, subjectLabel, teachRecording }: { bridge: DesktopBridge; experience: ComputerExperience; subjectLabel: string; teachRecording?: TeachRecordingComputerInjection["preview"] }) {
  const monitor = experience.monitors.find((candidate) => candidate.handoff != null) ?? experience.monitors[0] ?? null;
  const handoff = monitor?.handoff ?? experience.view.handoff;
  const handoffId = monitor?.handoff == null ? null : monitor.subagentId;
  const src = monitor?.vncUrl ?? experience.view.vncUrl;
  const dimensions = useMemo(() => vncDimensions(src ?? ""), [src]);
  const busy = !experience.view.isStatusUnavailable && (!experience.view.isStatusKnown || experience.view.phase === "pulling" || experience.view.phase === "starting");
  const copy = computerStageCopy({ isScreenLoading: false, isScreenUnavailable: experience.view.isStatusUnavailable, subjectLabel, isEmptyLoading: busy, pullPercent: experience.view.pullPercent });
  const hasPlaceholder = copy.isBusy || copy.hasRetry;
  let phase = experience.view.phase;
  if (experience.view.isStatusUnavailable) phase = "off";
  const frameRef = useCallback((element: HTMLDivElement | null) => bindVncPreviewFit(element, dimensions), [dimensions]);
  return <div aria-busy={busy || undefined} aria-label="Computer preview" className="sand-computer-preview sand-78zum5 sand-dt5ytf sand-pkkfsy" data-phase={experience.view.isStatusUnavailable ? "error" : experience.view.isStatusKnown ? phase : "loading"} role="region">
    {handoff == null ? null : <div aria-label="Needs your attention" className="sand-computer-preview__attention sand-9f619 sand-78zum5 sand-dt5ytf sand-1dbef6d sand-h8yej3 sand-a0y8cy sand-1pkpdue sand-1xvwvse sand-u624df" role="group">
      <span className="sand-78zum5 sand-dt5ytf sand-137clkk sand-euugli"><UiText color="yellow" size="md" weight="medium">Needs your attention</UiText><UiText className="sand-1wd3ewq sand-j0a0fe" size="md">{handoff.instruction.trim().length > 0 ? handoff.instruction : `${subjectLabel} needs you`}</UiText></span>
      <div className="sand-78zum5 sand-6s0dn4 sand-13a6bvl sand-1a02dak sand-11twubx"><button className={KIT_BUTTON_SECONDARY} data-sentiment="neutral" data-shape="rectangular" data-size="sm" data-variant="secondary" onClick={() => void experience.handBack(handoffId, "dismissed")} type="button"><span className="sand-euugli sand-b3r6kr sand-lyipyv">Skip this step</span></button><button className={KIT_BUTTON_PRIMARY} data-sentiment="neutral" data-shape="rectangular" data-size="sm" data-variant="primary" onClick={() => void experience.handBack(handoffId, "button")} type="button"><span className="sand-euugli sand-b3r6kr sand-lyipyv">I'm done, continue</span></button></div>
    </div>}
    <div className="sand-1n2onr6">
      <div className="sand-computer-preview__frame sand-1n2onr6 sand-78zum5 sand-6s0dn4 sand-l56j7k sand-h8yej3 sand-9f619 sand-t9pb60 sand-b3r6kr sand-i07v4r sand-4b2ntj sand-1ahgo13" ref={frameRef} style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
        <VncPool bridge={bridge} className="sand-47corl" src={src} />
        {src == null && !hasPlaceholder ? <DeviceDesktopIcon size="base" /> : null}
        <button aria-label={monitor?.title ?? "Open computer"} className="sand-computer-preview__open sand-10l6tqk sand-10a8y8t sand-htitgo sand-78zum5 sand-6s0dn4 sand-l56j7k sand-dj266r sand-1yf7rl7 sand-at24cr sand-j3b58b sand-1717udv sand-c342km sand-ng3xce sand-t9pb60 sand-jbqb8w sand-jyslct sand-1lugfcp sand-1ypdohk" onClick={() => experience.open(monitor?.subagentId, "preview")} title={monitor?.title} type="button">{src == null ? null : <span className="sand-3nfvp2 sand-6s0dn4 sand-pkkfsy sand-1i4c3av sand-12ffz05 sand-w3enoh sand-1846v19 sand-18ti0zn sand-47corl sand-1i4knns sand-19991ni sand-gdialr sand-9lcvmn"><ExpandIcon />Open</span>}</button>
        {src == null && hasPlaceholder ? <span className="sand-10l6tqk sand-10a8y8t sand-zkaem6 sand-78zum5 sand-6s0dn4 sand-l56j7k sand-47corl"><StagePlaceholder copy={copy} onRetry={experience.refresh} tone="pane" /></span> : null}
        {src == null ? null : <ComputerCursorOverlay cursor={experience.cursorFor(monitor?.subagentId ?? null)} framebuffer={dimensions} />}
        {teachRecording == null ? null : <TeachRecordingPreviewFrame actions={teachRecording.actions} projection={teachRecording.projection} />}
      </div>
      {teachRecording == null ? null : <TeachRecordingPreviewPeerRow actions={teachRecording.actions} projection={teachRecording.projection} />}
      <span className="sand-1lliihq sand-2b8uid"><UiText color="tertiary" size="sm">{subjectLabel}'s screen</UiText></span>
    </div>
  </div>;
}

export function ComputerInfoPane({ bridge, experience, isOpen, onClose, subjectLabel, teachRecording }: { bridge: DesktopBridge; experience: ComputerExperience; isOpen: boolean; onClose(): void; subjectLabel: string; teachRecording?: TeachRecordingComputerInjection["preview"] }) {
  const onResizePointerDown = useInfoPaneResize(bridge, onClose);
  const hidden = useInfoPaneCloseLinger(isOpen);
  return <aside aria-hidden={!isOpen || undefined} aria-label="Conversation details" className={`sand-info-pane sand--default-marker sand-1n2onr6 sand-1k3v4rp sand-1ms6mhf sand-5yr21d sand-2lwn1j sand-b3r6kr sand-lvsv26 sand-qwupev sand-9kvfbb${isOpen ? " sand-9c3od3 sand-1uxagwj" : " sand-nalus7"}`} data-open={isOpen || undefined} id={DETAILS_ID}>
    <div className={`sand-info-pane__inner sand-78zum5 sand-dt5ytf sand-9c3od3 sand-1uxagwj sand-5yr21d sand-2lwn1j sand-1ua6jya sand-qwldcu sand-9kvfbb ${isOpen ? "sand-1hc1fzr" : "sand-g01cxk"}`} hidden={hidden} inert={!isOpen}>
      <div className="sand-info-pane__nav-root sand-78zum5 sand-dt5ytf sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-2lwn1j">
        <header className={INFO_PANE_TOP}><span aria-hidden="true" /><span className={INFO_PANE_ACTIONS}><button aria-label="Close details" className={ICON_BUTTON_MD} data-size="md" data-variant="ghost" onClick={onClose} title="Close details" type="button"><MediumKitIcon codePoint={0xf31d} /></button></span></header>
        <div className="sand-info-pane__section-content sand-78zum5 sand-dt5ytf sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-2lwn1j">{experience.isOpen ? null : <ComputerPreview bridge={bridge} experience={experience} subjectLabel={subjectLabel} teachRecording={teachRecording} />}</div>
      </div>
    </div>
    {isOpen ? <div aria-label="Resize details" aria-orientation="vertical" className="sand-info-pane__resize-handle sand--default-marker sand-10l6tqk sand-13vifvy sand-1ey2m1c sand-u96u03 sand-1fsd2vl sand-1u8a7rm sand-icojor sand-5ve5x3 sand-lvsv26" onPointerDown={onResizePointerDown} role="separator"><span aria-hidden="true" className="sand-info-pane__resize-line sand-10l6tqk sand-13vifvy sand-1ey2m1c sand-u96u03 sand-4v8ngr sand-qjr0ry sand-11s1588 sand-omy3lu" /></div> : null}
  </aside>;
}

export function ComputerHeaderControl({ active, isInfoOpen, onToggle }: { active: boolean; isInfoOpen: boolean; onToggle(): void }) {
  if (isInfoOpen && !active) return null;
  const label = active ? COMPUTER_HEADER_LABELS.active : COMPUTER_HEADER_LABELS.idle;
  return <SandIconButton aria-controls={DETAILS_ID} aria-expanded={isInfoOpen} className={`${active ? "sand-1qfxjfa sand-11n3mlv sand-18ti0zn sand-hn7xur " : ""}sand-chat-header__computer`} data-computer-active={active || undefined} icon="computer" label={label} onClick={onToggle} size="md" />;
}

export function ComputerHandoffCard({ card, onOpen, onHandBack, onDismiss }: { card: ComputerHandoffCardProjection; onOpen(): void; onHandBack(): void; onDismiss(): void }) {
  const waiting = card.status === "waiting";
  const status = handoffStatusLabel(card.status);
  const titleId = useId();
  const instructionId = useId();
  const badgeClass = `sand-box-handoff-card__badge sand-3nfvp2 sand-6s0dn4 sand-17d4w8g sand-2lah0s sand-1nn3v0j sand-y13l1i sand-1120s5i sand-163pfp sand-149ho13${waiting
    ? " sand-1jnr06f sand-6wrskw sand-1izesbo sand-s0v71k"
    : status.muted ? " sand-19aaqeu sand-1ciwos8" : " sand-1w5rjie sand-1buh4up"}`;
  return <article aria-describedby={instructionId} aria-labelledby={titleId} className="sand-box-handoff-card sand-1g0q52m sand-78zum5 sand-dt5ytf sand-1v2ro7d sand-5c4s84 sand-193iq5w sand-c7ga6q sand-gqmno8" data-status={card.status}>
    <div className="sand-box-handoff-card__heading sand-78zum5 sand-dt5ytf sand-1jnr06f sand-h8yej3 sand-euugli">
      <div className="sand-box-handoff-card__header sand-78zum5 sand-1cy8zhl sand-167g77z sand-h8yej3 sand-euugli"><UiText className="sand-box-handoff-card__title sand-1iyjqo2 sand-s83m0k sand-euugli sand-1wd3ewq" id={titleId} size="lg" weight="medium">Computer</UiText><span className={badgeClass} data-status={card.status} role="status">{waiting ? <UiLoadingIcon /> : <span aria-hidden="true" className={`sand-1v4s8kt sand-ols6we sand-149ho13 sand-2lah0s ${status.muted ? "sand-xa9ouo" : "sand-1h27yg5"}`} />}<UiText size="md" weight="medium">{status.label}</UiText></span></div>
      <UiText className="sand-box-handoff-card__instruction sand-1wd3ewq sand-j0a0fe" id={instructionId} size="lg">{card.instruction.trim()}</UiText>
    </div>
    {waiting ? <button aria-label="Take over the computer" className="sand-box-handoff-card__frame sand-1n2onr6 sand-h8yej3 sand-d83jor sand-ur7f20 sand-b3r6kr sand-1ua6jya sand-78zum5 sand-6s0dn4 sand-l56j7k sand-4b2ntj sand-1ghz6dp sand-1717udv sand-ng3xce sand-jyslct sand-1lugfcp sand-jb2p0i sand-1ypdohk sand-i5y0ii sand-egtswm sand-js1wst" onClick={onOpen} type="button">{card.snapshotDataUrl == null ? <DeviceDesktopIcon /> : <img alt="" aria-hidden="true" className="sand-box-handoff-card__image sand-h8yej3 sand-5yr21d sand-l1xv1r sand-1lliihq" draggable={false} src={card.snapshotDataUrl} />}</button> : null}
    <div className="sand-box-handoff-card__footer sand-78zum5 sand-6s0dn4 sand-1a02dak sand-167g77z sand-h8yej3 sand-euugli">{waiting ? <><button className={ASK_BUTTON_PRIMARY} data-color="monochrome" data-size="md" data-variant="primary" onClick={onOpen} type="button">Take over</button><button className={ASK_BUTTON_OUTLINE} data-size="md" data-variant="outline" onClick={onHandBack} type="button">I’m done</button><button className={`sand-box-handoff-card__dismiss ${ASK_BUTTON_TEXT}`} data-color="tertiary" data-size="md" data-variant="text" onClick={onDismiss} title="Cancel this request without doing the step; the agent continues without it" type="button">Skip</button></> : <button className={ASK_BUTTON_OUTLINE} data-size="md" data-variant="outline" onClick={onOpen} type="button"><DeviceDesktopIcon />Open computer</button>}</div>
  </article>;
}

export function renderComputerHandoffEntry(entry: TranscriptComputerHandoff, experience: ComputerExperience) {
  const card = experience.cardFor(entry);
  return <div className="sand-box-handoff-card-wrap" key={entry.id}><ComputerHandoffCard
    card={card}
    onDismiss={() => void experience.handBack(card.subagentId, "dismissed")}
    onHandBack={() => void experience.handBack(card.subagentId, "button")}
    onOpen={() => experience.open(card.subagentId, "handoff")}
  /></div>;
}
