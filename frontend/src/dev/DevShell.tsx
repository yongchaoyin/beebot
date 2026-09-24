import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { attachDomInspector, type InspectedElement } from "./dom-inspector";
import { matchRecoveredBoundaries } from "../recovered/catalog";
import { recoveredEntrypoints } from "../recovered/runtime/entrypoints";
import { HiddenChatsDialog } from "../recovered/features/hidden-chats/overlay/view";
import type { HiddenAgentSummary } from "../recovered/features/hidden-chats/overlay/model";
import { SettingsModalShell, type SettingsSectionId } from "../recovered/features/settings/overlay/view";
import { GeneralSettingsPanel, UpdatesSettingsPanel, UsageSettingsPanel } from "../recovered/features/settings/overlay/panels";
import type { UpdateTrack } from "../recovered/features/settings/overlay/updates";
import type { AutoReviewSettings } from "../recovered/features/settings/overlay/auto-review";
import { SettingsDesktopPreview } from "../recovered/features/settings/overlay/desktop-preview";
import { OrgChartGraph, type RenderableOrgChartAgent } from "../recovered/features/org-chart/workspace/graph";
import { PluginsDialogShell, type PluginsDialogShellProps } from "../recovered/features/plugins/overlay/view";
import { PluginsDesktopPreview } from "../recovered/features/plugins/overlay/desktop-preview";
import { hasDesktopBridge } from "../recovered/contracts/desktop-bridge";
import { ConversationWorkspacePreview } from "../recovered/features/conversation/workspace/view";

type BootState = "loading" | "ready" | "failed";

interface DevShellProps {
  upstreamBoot: Promise<unknown>;
}

async function control(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/__sand_control${path}`, init);
  if (!response.ok) throw new Error(`control request failed: ${response.status}`);
  if (response.status === 204) return null;
  return await response.json();
}

export function DevShell({ upstreamBoot }: DevShellProps) {
  const [open, setOpen] = useState(false);
  const [boot, setBoot] = useState<BootState>("loading");
  const [inspecting, setInspecting] = useState(false);
  const [picked, setPicked] = useState<InspectedElement | null>(null);
  const [controlStatus, setControlStatus] = useState("checking");
  const [sourcePreview, setSourcePreview] = useState<"hidden-chats" | "settings" | "org-chart" | "plugins" | "conversation" | null>(null);
  const [previewDataMode, setPreviewDataMode] = useState<"fixtures" | "desktop">("fixtures");
  const [previewStatus, setPreviewStatus] = useState("ready");
  const [previewAgents, setPreviewAgents] = useState<HiddenAgentSummary[]>([
    { id: "research", name: "Research Bot" },
    { id: "release", name: "Release Investigator" }
  ]);
  const [previewTheme, setPreviewTheme] = useState<"system" | "light" | "dark">("system");
  const [previewTrack, setPreviewTrack] = useState<UpdateTrack>("nightly");
  const [previewAutoUpdate, setPreviewAutoUpdate] = useState(true);
  const [previewAutoReview, setPreviewAutoReview] = useState<AutoReviewSettings>({
    isEnabled: true,
    allowInstructions: ["Read project files before proposing code changes"],
    blockInstructions: ["Delete files or history without asking"]
  });
  const previewOrgAgents: RenderableOrgChartAgent[] = [
    { id: "lead", name: "Research Lead", isGroup: false, memberIds: [], conversationPartnerIds: ["writer", "reviewer"], awaitingUserResponse: null, isRunning: true, updatedAt: Date.now() - 12_000 },
    { id: "writer", name: "Implementation", isGroup: false, memberIds: [], conversationPartnerIds: ["lead"], awaitingUserResponse: null, isRunning: true, updatedAt: Date.now() - 8_000 },
    { id: "reviewer", name: "Reviewer", isGroup: false, memberIds: [], conversationPartnerIds: ["lead"], awaitingUserResponse: { reason: "approval" }, isRunning: false, updatedAt: Date.now() - 40_000 },
    { id: "room", name: "Recovery Room", isGroup: true, memberIds: ["lead", "writer", "reviewer"], conversationPartnerIds: [], awaitingUserResponse: null, isRunning: false, updatedAt: Date.now() - 90_000 }
  ];
  const previewPlugins: PluginsDialogShellProps["items"] = [
    { kind: "plugin", id: "calendar", displayName: "Calendar", description: "Read events and coordinate schedules.", publisher: "Cursor", installed: false },
    { kind: "plugin", id: "linear", displayName: "Linear", description: "Search and update issues and projects.", publisher: "Cursor", installed: true },
    { kind: "server", id: "github", displayName: "GitHub", description: "Repository tools and pull request workflows.", accountLabel: "source-lab", status: "connected" },
    { kind: "server", id: "salesforce", displayName: "Salesforce", description: "Customer and opportunity data.", status: "authentication-required" },
    { kind: "workflow", id: "release-notes", displayName: "Release notes", description: "Draft release summaries from merged work.", enabled: true, sourceUrl: "https://example.test/release-notes" }
  ];

  useEffect(() => {
    let active = true;
    upstreamBoot.then(
      () => active && setBoot("ready"),
      (error) => {
        console.error("Recovered renderer failed to boot", error);
        if (active) setBoot("failed");
      }
    );
    return () => {
      active = false;
    };
  }, [upstreamBoot]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, []);

  useEffect(() => {
    if (!inspecting) return;
    return attachDomInspector((element) => {
      setPicked(element);
      setInspecting(false);
      setOpen(true);
    });
  }, [inspecting]);

  useEffect(() => {
    control("/gateway-offline")
      .then((value) => setControlStatus(JSON.stringify(value)))
      .catch(() => setControlStatus("starting"));
  }, []);

  const setOffline = async (offline: boolean) => {
    setControlStatus("applying");
    try {
      const value = await control(`/gateway-offline?induced=${offline ? "1" : "0"}`, { method: "POST" });
      setControlStatus(JSON.stringify(value));
    } catch (error) {
      setControlStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const recoveredMatches = picked == null ? [] : matchRecoveredBoundaries(picked);
  const desktopBridge = hasDesktopBridge(window.desktop) ? window.desktop : null;

  if (!open) {
    return (
      <button className={`badge badge--${boot}`} onClick={() => setOpen(true)} title="Open reconstructed developer tools (⌘⇧D)">
        0.18 DEV · {boot}
      </button>
    );
  }

  return (
    <aside className="panel">
      <header>
        <div>
          <strong>0.18 reconstructed</strong>
          <span>renderer lab</span>
        </div>
        <button className="icon" onClick={() => setOpen(false)} aria-label="Close developer panel">×</button>
      </header>

      <section>
        <label>Recovered renderer</label>
        <output data-state={boot}>{boot}</output>
        <label>Desktop preload</label>
        <output>{hasDesktopBridge(window.desktop) ? "connected" : "missing"}</output>
        <label>Control server</label>
        <output>{controlStatus}</output>
      </section>

      <label className="live-preview-toggle">
        <input
          checked={previewDataMode === "desktop"}
          disabled={desktopBridge == null}
          onChange={(event) => setPreviewDataMode(event.currentTarget.checked ? "desktop" : "fixtures")}
          type="checkbox"
        />
        <span>Use live desktop state and actions</span>
        <small>Off by default. Live mode reads and can change this isolated development profile.</small>
      </label>

      <div className="actions">
        <button onClick={() => setInspecting((value) => !value)}>{inspecting ? "Cancel inspect" : "Inspect element"}</button>
        <button onClick={() => void control("/reload", { method: "POST" })}>Reload app</button>
        <button onClick={() => void setOffline(true)}>Gateway offline</button>
        <button onClick={() => void setOffline(false)}>Gateway online</button>
        <button onClick={() => setSourcePreview("hidden-chats")}>Preview Hidden Chats</button>
        <button onClick={() => setSourcePreview("settings")}>Preview Settings</button>
        <button onClick={() => setSourcePreview("org-chart")}>Preview Org Chart</button>
        <button onClick={() => setSourcePreview("plugins")}>Preview Plugins</button>
        <button onClick={() => setSourcePreview("conversation")}>Preview Conversation</button>
      </div>

      {sourcePreview === "hidden-chats" ? createPortal(
        <div className="recovered-source-preview-backdrop" data-recovered-source-preview="hidden-chats">
          <HiddenChatsDialog
            hiddenAgents={previewAgents}
            isOpen
            onClose={() => setSourcePreview(null)}
            onOpenAgent={(agentId) => setPreviewStatus(`open ${agentId}`)}
            onUnhide={(agentId) => {
              setPreviewAgents((agents) => agents.filter((agent) => agent.id !== agentId));
              setPreviewStatus(`unhidden ${agentId}`);
            }}
          />
        </div>,
        document.body
      ) : null}

      {sourcePreview === "settings" ? createPortal(
        <div className="recovered-settings-preview-backdrop" data-recovered-source-preview="settings">
          {previewDataMode === "desktop" && desktopBridge != null ? <SettingsDesktopPreview
            bridge={desktopBridge}
            isOpen
            onClose={() => setSourcePreview(null)}
            onStatus={setPreviewStatus}
          /> : <SettingsModalShell
            initialSection="general"
            isOpen
            onClose={() => setSourcePreview(null)}
            renderSection={(section: SettingsSectionId, selectSection) => {
              if (section === "general") {
                return <GeneralSettingsPanel
                  onOpenConnectionSection={selectSection}
                  account={{ kind: "logged-in", name: "Recovered Developer", email: "source@example.test" }}
                  autoReview={{ settings: previewAutoReview, onChange: (settings) => {
                    setPreviewAutoReview(settings);
                    setPreviewStatus("auto-review changed");
                  } }}
                  onAccountAction={() => setPreviewStatus("account action")}
                  onThemeChange={(theme) => {
                    setPreviewTheme(theme);
                    setPreviewStatus(`theme ${theme}`);
                  }}
                  theme={previewTheme}
                />;
              }
              if (section === "usage") {
                return <UsageSettingsPanel provider="openrouter" />;
              }
              return <UpdatesSettingsPanel
                autoUpdateWhenIdle={previewAutoUpdate}
                availableTracks={["stable", "nightly", "dogfood"]}
                onCheck={() => setPreviewStatus("update check")}
                onSetAutoUpdateWhenIdle={(enabled) => {
                  setPreviewAutoUpdate(enabled);
                  setPreviewStatus(`auto-update ${enabled ? "on" : "off"}`);
                }}
                onSetTrack={(track) => {
                  setPreviewTrack(track);
                  setPreviewStatus(`track ${track}`);
                }}
                status={{ currentTrack: previewTrack, currentVersion: "0.18.0", state: { type: "idle", lastCheck: { result: "up-to-date" } } }}
              />;
            }}
          />}
        </div>,
        document.body
      ) : null}

      {sourcePreview === "org-chart" ? createPortal(
        <div className="recovered-org-chart-preview-backdrop" data-recovered-source-preview="org-chart">
          <div className="recovered-org-chart-preview">
            <header>
              <h2>Org chart · recovered source</h2>
              <button aria-label="Close" onClick={() => setSourcePreview(null)} type="button">×</button>
            </header>
            <OrgChartGraph
              agents={previewOrgAgents}
              height={500}
              onOpenAgent={(agentId) => setPreviewStatus(`selected ${agentId}`)}
              width={760}
            />
          </div>
        </div>,
        document.body
      ) : null}

      {sourcePreview === "plugins" ? createPortal(
        <div className="recovered-plugins-preview-backdrop" data-recovered-source-preview="plugins">
          {previewDataMode === "desktop" && desktopBridge != null ? <PluginsDesktopPreview
            bridge={desktopBridge}
            isOpen
            onClose={() => setSourcePreview(null)}
            onStatus={setPreviewStatus}
          /> : <PluginsDialogShell
            isOpen
            items={previewPlugins}
            onAuthenticate={(serverId) => setPreviewStatus(`authenticate ${serverId}`)}
            onClose={() => setSourcePreview(null)}
            onInstall={(pluginId) => setPreviewStatus(`install ${pluginId}`)}
            onRemove={(item) => setPreviewStatus(`remove ${item.id}`)}
            onToggleWorkflow={(workflowId, enabled) => setPreviewStatus(`${enabled ? "enable" : "disable"} ${workflowId}`)}
          />}
        </div>,
        document.body
      ) : null}

      {sourcePreview === "conversation" ? createPortal(
        <div className="recovered-conversation-preview-backdrop" data-recovered-source-preview="conversation">
          <ConversationWorkspacePreview
            bridge={previewDataMode === "desktop" ? desktopBridge : null}
            onClose={() => setSourcePreview(null)}
            onStatus={setPreviewStatus}
          />
        </div>,
        document.body
      ) : null}

      <details className="recoveries">
        <summary>Recovered feature boundaries ({recoveredEntrypoints.length})</summary>
        <output className="preview-status">source preview: {previewStatus}</output>
        <ul>
          {recoveredEntrypoints.map((entrypoint) => (
            <li key={entrypoint.id}>
              <strong>{entrypoint.name}</strong>
              <span>{entrypoint.originalViewPath}</span>
              <code>{entrypoint.recovery}</code>
            </li>
          ))}
        </ul>
      </details>

      {picked ? (
        <section className="picked">
          <label>Selected UI surface</label>
          <code>{picked.selector}</code>
          {recoveredMatches.map((boundary) => (
            <p key={boundary.symbol}>boundary: {boundary.name} ({boundary.symbol}, line {boundary.line}, {boundary.confidence})</p>
          ))}
          {picked.ariaLabel ? <p>aria: {picked.ariaLabel}</p> : null}
          {picked.text ? <p>text: {picked.text}</p> : null}
          <p>classes: {picked.classes.join(" ") || "none"}</p>
        </section>
      ) : (
        <p className="hint">Pick a shipped UI element to capture its stable selector, accessible name, and text before extracting it into a semantic module.</p>
      )}

      <footer>⌘⇧D panel · ⌘⌥I Chromium DevTools</footer>
    </aside>
  );
}
