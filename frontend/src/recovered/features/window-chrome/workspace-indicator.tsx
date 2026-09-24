import "./workspace-indicator.css";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L120322

export interface WorkspaceIndicatorProps {
  isFullscreen: boolean;
  label: string | null;
}

export function WorkspaceIndicator({ isFullscreen, label }: WorkspaceIndicatorProps) {
  if (isFullscreen || label == null || label.length === 0) return null;
  return <div aria-label={label} aria-level={1} className="bb-window-workspace-label" role="heading">
    <span className="sand-chat-header__name" title={label}>{label}</span>
  </div>;
}
