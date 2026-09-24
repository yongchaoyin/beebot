import { installNativeWindowLayout } from "../../../presence/window-layout";
import { useEffect, useLayoutEffect } from "react";
import type { DesktopBridge } from "../../contracts/desktop-bridge";
import { setWindowChromeVariables, WINDOW_CHROME_METRICS } from "./model";
import "./view.css";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L132738
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5540170 (sand-window-controls selector)

const DRAG_REGION_CLASS_NAME = "sand-ixxii4 sand-13vifvy sand-u96u03 sand-3m8u43 sand-dd8jsf sand-143p3il sand-avu8j0";
const OUTER_CLASS_NAME = "sand-ixxii4 sand-13vifvy sand-3m8u43 sand-11l0jo9 sand-1tdo9wn sand-78zum5 sand-6s0dn4 sand-op6jhs sand-67bb7w sand-avu8j0 sand-1wfn6di";
const INNER_CLASS_NAME = "sand-78zum5 sand-6s0dn4 sand-195vfkc sand-muz1kq";
const CONTROL_CLASS_NAME = "sand-jyslct sand-1lugfcp sand-lvsv26 sand-482pwi sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-14qfxbe sand-1fgtraw sand-1717udv sand-ng3xce sand-ur7f20 sand-jbqb8w sand-1gpdhcw sand-tnf0us sand-19aaqeu sand-7gh5u8 sand-t0e3qv sand-1t137rt sand-1ge13bo";
const CLOSE_CONTROL_CLASS_NAME = "sand-jyslct sand-1lugfcp sand-lvsv26 sand-482pwi sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-14qfxbe sand-1fgtraw sand-1717udv sand-ng3xce sand-ur7f20 sand-t0e3qv sand-1t137rt sand-1ge13bo sand-jbqb8w sand-1u9o498 sand-1czjr01 sand-19aaqeu sand-1n02auv";

type WindowIconName = "minus" | "copy" | "square" | "close";

function WindowIcon({ name }: { name: WindowIconName }) {
  const path = name === "minus"
    ? "M2 6h8"
    : name === "copy"
      ? "M4 4h6v6H4z M2 2h6v2"
      : name === "square"
        ? "M2 2h8v8H2z"
        : "M3 3l6 6M9 3L3 9";
  return <svg aria-hidden="true" data-icon-name={name} data-size={WINDOW_CHROME_METRICS.iconSize} height={WINDOW_CHROME_METRICS.iconSize} viewBox="0 0 12 12" width={WINDOW_CHROME_METRICS.iconSize}><path d={path} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" /></svg>;
}

export interface WindowChromeProps {
  bridge: DesktopBridge;
  isFullscreen: boolean;
  isMaximized: boolean;
  isOverlayTone?: boolean;
}

export function WindowChrome({ bridge, isFullscreen, isMaximized, isOverlayTone = false }: WindowChromeProps) {
  useLayoutEffect(() => installNativeWindowLayout(document, bridge.platform, isFullscreen), [bridge.platform, isFullscreen]);
  useEffect(() => setWindowChromeVariables(bridge.platform, isFullscreen), [bridge.platform, isFullscreen]);

  useEffect(() => {
    if (bridge.platform !== "win32") return;
    void bridge.windowControls.setTitleBarOverlayTone(!isFullscreen && isOverlayTone).catch(() => undefined);
  }, [bridge, isFullscreen, isOverlayTone]);

  const dragRegion = <div aria-hidden="true" className={`sand-cover-drag ${DRAG_REGION_CLASS_NAME}`} />;
  if (bridge.platform === "darwin") return dragRegion;
  if (bridge.platform === "win32") return <>{dragRegion}<div aria-hidden="true" className="sand-window-controls" style={{ display: "none" }} /></>;
  if (isFullscreen) return dragRegion;

  return <>{dragRegion}<div className={`sand-window-controls ${OUTER_CLASS_NAME}`}>
    <div className={INNER_CLASS_NAME}>
      <button aria-label="Minimize" className={CONTROL_CLASS_NAME} onClick={() => void bridge.windowControls.minimize().catch(() => undefined)} title="Minimize" type="button"><WindowIcon name="minus" /></button>
      <button aria-label={isMaximized ? "Restore" : "Maximize"} className={CONTROL_CLASS_NAME} onClick={() => void bridge.windowControls.toggleMaximize().catch(() => undefined)} title={isMaximized ? "Restore" : "Maximize"} type="button"><WindowIcon name={isMaximized ? "copy" : "square"} /></button>
      <button aria-label="Close" className={CLOSE_CONTROL_CLASS_NAME} onClick={() => void bridge.windowControls.close().catch(() => undefined)} title="Close" type="button"><WindowIcon name="close" /></button>
    </div>
  </div></>;
}
