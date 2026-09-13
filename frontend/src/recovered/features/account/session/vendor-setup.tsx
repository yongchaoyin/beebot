import { useEffect, useMemo, useState } from "react";
import type { CursorAuthStatus, DesktopBridge } from "../../../contracts/desktop-bridge";
import { HTTP_ROUTER_PROVIDERS, httpRouterProviderById, type HttpRouterProviderId } from "../../settings/overlay/router";
import { SandButton } from "../../../ui/sand-kit-primitives";

export interface VendorSetupProps {
  bridge: Pick<DesktopBridge, "agent" | "secrets" | "cursorAccount">;
  onStatus(status: CursorAuthStatus): void;
  submitLabel?: string;
}

export function VendorSetup({ bridge, onStatus, submitLabel = "Start using" }: VendorSetupProps) {
  const [provider, setProvider] = useState<HttpRouterProviderId>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(httpRouterProviderById("openrouter").defaultBaseUrl);
  const [modelId, setModelId] = useState(httpRouterProviderById("openrouter").defaultModelId);
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => httpRouterProviderById(provider), [provider]);

  useEffect(() => {
    let active = true;
    void Promise.all([bridge.secrets.list().catch(() => ({ keys: [] as string[] })), bridge.agent.getInferenceRouter().catch(() => null)]).then(([secrets, router]) => {
      if (!active) return;
      setSavedKeys(Array.isArray(secrets.keys) ? secrets.keys : []);
      const next = HTTP_ROUTER_PROVIDERS.find((item) => item.id === router?.provider) ?? HTTP_ROUTER_PROVIDERS[0]!;
      setProvider(next.id);
      setBaseUrl(router?.http?.baseUrl || next.defaultBaseUrl);
      setModelId(router?.http?.modelId || next.defaultModelId);
    });
    return () => { active = false; };
  }, [bridge]);

  const selectProvider = (id: HttpRouterProviderId) => {
    const next = httpRouterProviderById(id);
    setProvider(next.id);
    setBaseUrl(next.defaultBaseUrl);
    setModelId(next.defaultModelId);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await bridge.agent.setInferenceRouter({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim()
      });
      onStatus(await bridge.cursorAccount.getStatus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sand-vendor-setup" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>
        <span>Vendor</span>
        <select aria-label="Vendor" disabled={busy} onChange={(event) => selectProvider(event.currentTarget.value as HttpRouterProviderId)} value={provider}>
          {HTTP_ROUTER_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label>
        <span>API key</span>
        <input
          aria-label="API key"
          autoComplete="off"
          disabled={busy}
          onChange={(event) => setApiKey(event.currentTarget.value)}
          placeholder={savedKeys.includes(selected.secretKey) ? "Key saved — paste to replace" : "Paste API key"}
          spellCheck={false}
          type="password"
          value={apiKey}
        />
      </label>
      <label>
        <span>Base URL</span>
        <input aria-label="Base URL" disabled={busy} onChange={(event) => setBaseUrl(event.currentTarget.value)} spellCheck={false} value={baseUrl} />
      </label>
      <label>
        <span>Model ID</span>
        <input aria-label="Model ID" disabled={busy} onChange={(event) => setModelId(event.currentTarget.value)} spellCheck={false} value={modelId} />
      </label>
      <SandButton disabled={busy || apiKey.trim().length === 0} size="sm" type="submit">{busy ? "Saving…" : submitLabel}</SandButton>
      {error == null ? null : <p aria-live="polite">{error}</p>}
    </form>
  );
}

export default VendorSetup;
