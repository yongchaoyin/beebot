import "./presence/entry";
import { ProductionRenderer } from "./production/ProductionRenderer";
import { acquireProductionRendererRuntime, mountProductionRenderer, requireProductionRendererMount } from "./production/bootstrap";
import { PRODUCTION_RENDERER_GAPS } from "./production/evidence";
import { RootShellErrorBoundary } from "./recovered/features/window-chrome/root-shell-state";

const mount = requireProductionRendererMount(document.getElementById("root"));
const runtime = acquireProductionRendererRuntime(window);
mountProductionRenderer(mount, <RootShellErrorBoundary><ProductionRenderer {...runtime} /></RootShellErrorBoundary>);

const reportHealth = async () => {
  const health = {
    ready: mount.childElementCount > 0,
    title: document.title,
    url: location.href,
    preload: typeof window.desktop === "object" && typeof window.coordinatorPort === "object",
    sourceComposed: true,
    upstreamEntry: false,
    cleanEntrypoint: "frontend/src/main.tsx",
    recoveredEntrypoints: 5,
    viteClient: import.meta.hot != null,
    surfaces: ["shell", "account", "sign-in", "conversation", "transcript", "composer", "sidebar", "agents", "settings", "plugins", "updates", "deep-links", "desktop-bridge"],
    evidenceGaps: Object.keys(PRODUCTION_RENDERER_GAPS)
  };
  try {
    await fetch("/__reconstructed_health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(health)
    });
  } catch {
    // The health endpoint is available only in the reconstruction development host.
  }
};
window.requestAnimationFrame(() => void reportHealth());

if (import.meta.hot) {
  import.meta.hot.accept();
}
