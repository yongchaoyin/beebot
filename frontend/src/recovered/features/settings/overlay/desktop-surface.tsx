import { useCallback, useEffect, useRef, useState } from "react";
// @evidence src/app/dist/renderer/assets/index-BlqerJhg.js#byteOffset=36041 (released Settings Retry copy)
import type { ProductionCoordinatorClient } from "../../../../production/coordinator-client";
// @evidence src/app/dist/renderer/assets/index-BlqerJhg.js#L1
import type { DesktopBridge, DesktopUpdateStatus, ThemePreference } from "../../../contracts/desktop-bridge";
import {
  accountStateFromCursorStatus,
  cursorAuthErrorMessage,
  installUpdate,
  loadSettingsDesktopSnapshot,
  loadUsageState,
  cancelUsageTrial,
  checkForUpdatesWithRecovery,
  runAccountAction,
  runUsageUpgradeAction,
  runUsageUpgradeActionAndRefresh,
  saveAutoReviewSettings,
  setLocalToolPermission,
  setSecurityKeyEnabled,
  setEgressTunnelEnabled,
  setThemePreference,
  setTimeZoneOverride,
  subscribeToSettingsDesktop,
  egressTunnelFeatureGateEnabled,
  normalizeEgressTunnelStatus,
  shouldShowUsageSettings,
  usagePageFeatureGateEnabled,
  usageMetersFromSummary,
  type SettingsDesktopSnapshot
} from "./desktop";
import { GeneralSettingsPanel, RouterSettingsPanel, UpdatesSettingsPanel, UsageSettingsPanel } from "./panels";
import { SettingsModalShell, type SettingsSectionId } from "./view";
import { DEFAULT_ROUTER_PROVIDER, HTTP_ROUTER_PROVIDERS, loadRouterProvider, saveRouterProvider, type RouterProviderId } from "./router";
import type { AutoReviewSettings } from "./auto-review";
import type { SettingsComputerMount } from "./computer";
import { SettingsNoticeView, settingsNoticeFromEvent, type SettingsNotice } from "./notice";
import { publishSurfaceNotice, type SettingsNoticeEvent } from "../../../contracts/surface-notice";
import { SandButton } from "../../../ui/sand-kit-primitives";

const SETTINGS_FALLBACK_LABELS = { retry: "Retry" };

function ServersSettingsPanel({ onOpenBot }: { onOpenBot(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const onOpenBotRef = useRef(onOpenBot);
  useEffect(() => { onOpenBotRef.current = onOpenBot; }, [onOpenBot]);
  useEffect(() => {
    if (host.current == null) return;
    const mount = (window as Window & {
      __beebotMountServersSettings?: (root: HTMLElement, options: { onOpenBot(): void }) => (() => void) | undefined;
    }).__beebotMountServersSettings;
    if (mount == null) {
      host.current.textContent = "Server connections are not available in this build.";
      return;
    }
    return mount(host.current, { onOpenBot: () => onOpenBotRef.current() });
  }, []);
  return <div ref={host} style={{ minWidth: 0 }} />;
}

export interface SettingsDesktopSurfaceProps {
  bridge: DesktopBridge;
  coordinatorClient?: ProductionCoordinatorClient | null;
  initialSection?: SettingsSectionId;
  isOpen: boolean;
  onClose(): void;
  onNotice?(event: SettingsNoticeEvent): void;
  onStatus?(status: string): void;
  /** Root-owned computer rebuild state/actions; omitted until the root owner mounts the handoff. */
  computer?: SettingsComputerMount;
}

export function SettingsDesktopSurface({ bridge, coordinatorClient = null, initialSection = "general", isOpen, onClose, onNotice, onStatus, computer }: SettingsDesktopSurfaceProps) {
  const [snapshot, setSnapshot] = useState<SettingsDesktopSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [surfaceNotice, setSurfaceNotice] = useState<SettingsNotice | null>(null);
  const [cancelTrialDialogOpen, setCancelTrialDialogOpen] = useState(false);
  const [routerProvider, setRouterProvider] = useState<RouterProviderId>(DEFAULT_ROUTER_PROVIDER);
  const [routerPending, setRouterPending] = useState(false);
  const [routerHttp, setRouterHttp] = useState({ apiKey: "", baseUrl: "", modelId: "" });
  const [uiLanguage, setUiLanguage] = useState<"en" | "zh">("en");
  const [vendorAccounts, setVendorAccounts] = useState<{ vendors: { id: string; label: string; provider: string; baseUrl: string; modelId: string }[]; defaultVendorId: string | null }>({ vendors: [], defaultVendorId: null });
  const [vendorAccountsPending, setVendorAccountsPending] = useState(false);
  const [vendorAccountsError, setVendorAccountsError] = useState<string | null>(null);
  const handleCancelTrialDialogOpen = useCallback((open: boolean) => setCancelTrialDialogOpen(open), []);
  const handleNotice = useCallback((event: SettingsNoticeEvent) => {
    setSurfaceNotice(settingsNoticeFromEvent(event));
    onNotice?.(event);
  }, [onNotice]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    let unsubscribe = () => {};
    setSnapshot(null);
    setError(null);
    const refreshEgressAvailability = () => {
      if (coordinatorClient == null) return;
      void coordinatorClient.isEgressTunnelAvailable().then((available) => {
        if (!active) return;
        setSnapshot((current) => current == null ? current : { ...current, egressTunnel: { ...current.egressTunnel, available } });
      }).catch(() => {
        // The shipped capability store keeps the last value on a failed reread.
      });
    };
    void loadSettingsDesktopSnapshot(bridge, coordinatorClient ?? undefined).then((value) => {
      if (!active) return;
      setSnapshot(value);
      unsubscribe = subscribeToSettingsDesktop(bridge, {
        account: (status) => {
          setSnapshot((current) => current == null ? current : {
            ...current,
            account: accountStateFromCursorStatus(
              status,
              current.account.kind === "logged-in" ? current.account.avatarDataUrl : undefined
            ),
            accountPending: current.accountPending,
            accountError: status.kind === "logged-out" ? status.errorMessage ?? null : null
          });
          refreshEgressAvailability();
        },
        theme: (state) => setSnapshot((current) => current == null ? current : { ...current, theme: state.preference }),
        update: (update) => setSnapshot((current) => current == null ? current : { ...current, update }),
        securityKey: updateSecurityKey,
        experiments: (experimentSnapshot) => setSnapshot((current) => current == null ? current : {
          ...current,
          usagePageFeatureGateEnabled: usagePageFeatureGateEnabled(experimentSnapshot),
          egressTunnel: { ...current.egressTunnel, featureGateEnabled: egressTunnelFeatureGateEnabled(experimentSnapshot) }
        }),
        egressTunnel: (enabled) => setSnapshot((current) => current == null ? current : {
          ...current,
          egressTunnel: { ...current.egressTunnel, enabled }
        }),
        egressTunnelStatus: (status) => setSnapshot((current) => current == null ? current : {
          ...current,
          egressTunnel: { ...current.egressTunnel, status: normalizeEgressTunnelStatus(status) }
        })
      });
      const unsubscribeCoordinator = coordinatorClient?.subscribeTransport((state) => {
        if (state === "connected") refreshEgressAvailability();
      });
      const previousUnsubscribe = unsubscribe;
      unsubscribe = () => {
        previousUnsubscribe();
        unsubscribeCoordinator?.();
      };
    }).catch((reason: unknown) => {
      if (!active) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      publishSurfaceNotice({ kind: "error", operation: "settings-load", message }, handleNotice, onStatus);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge, coordinatorClient, handleNotice, isOpen, onStatus, reload]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void bridge.agent.getUiLanguage?.().then((value) => { if (active && value?.language === "zh") setUiLanguage("zh"); }).catch(() => undefined);
    void bridge.agent.getInferenceVendors?.().then((listed) => {
      if (!active) return;
      setVendorAccounts({ vendors: [...(listed?.vendors ?? [])], defaultVendorId: listed?.defaultVendorId ?? null });
    }).catch(() => undefined);
    void bridge.agent.getInferenceRouter().then((router) => {
      if (!active) return;
      const provider = HTTP_ROUTER_PROVIDERS.some((item) => item.id === router.provider) || router.provider === "cursor" || router.provider === "claude-code" || router.provider === "codex"
        ? router.provider as RouterProviderId
        : DEFAULT_ROUTER_PROVIDER;
      setRouterProvider(provider);
      const http = HTTP_ROUTER_PROVIDERS.find((item) => item.id === provider);
      setRouterHttp({
        apiKey: "",
        baseUrl: router.http?.baseUrl || http?.defaultBaseUrl || "",
        modelId: router.http?.modelId || http?.defaultModelId || ""
      });
    }).catch(() => {
      if (!active) return;
      void loadRouterProvider(bridge.agent.clientPersistence).then((provider) => {
        if (active) setRouterProvider(provider);
      }).catch(() => {
        if (active) setRouterProvider(DEFAULT_ROUTER_PROVIDER);
      });
    });
    return () => { active = false; };
  }, [bridge, isOpen]);

  const mutate = async <Value,>(action: () => Promise<Value>, operation: SettingsNoticeEvent["operation"], apply: (value: Value) => void): Promise<Value> => {
    try {
      const value = await action();
      apply(value);
      return value;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      publishSurfaceNotice({ kind: "error", operation, message }, handleNotice, onStatus);
      throw reason;
    }
  };

  const updateSnapshot = (update: DesktopUpdateStatus) => setSnapshot((current) => current == null ? current : { ...current, update });
  const updateTheme = (theme: ThemePreference) => setSnapshot((current) => current == null ? current : { ...current, theme });
  const updateTimeZone = (timeZone: SettingsDesktopSnapshot["timeZone"]) => setSnapshot((current) => current == null ? current : { ...current, timeZone });
  const updateLocalToolPermission = (permission: SettingsDesktopSnapshot["localToolPermission"]["permission"]) => setSnapshot((current) => current == null ? current : {
    ...current,
    localToolPermission: { ...current.localToolPermission, permission }
  });
  const updateSecurityKey = (securityKeyEnabled: boolean) => setSnapshot((current) => current == null ? current : { ...current, securityKeyEnabled });
  const updateAutoReview = (autoReview: AutoReviewSettings) => setSnapshot((current) => current == null ? current : { ...current, autoReview });
  const refreshUsage = async () => {
    const previous = snapshot?.usage;
    setSnapshot((current) => current == null ? current : {
      ...current,
      usage: { status: "loading", summary: current.usage.summary },
      usageSummary: current.usage.summary
    });
    const usage = await loadUsageState(bridge, previous);
    setSnapshot((current) => current == null ? current : { ...current, usage, usageSummary: usage.summary });
  };

  return (
    <>
      <SettingsNoticeView notice={surfaceNotice} onDismiss={() => setSurfaceNotice(null)} />
      <SettingsModalShell
      initialSection={initialSection}
      isOpen={isOpen}
      onClose={onClose}
      renderSection={(section: SettingsSectionId, selectSection) => {
        if (section === "servers") return <ServersSettingsPanel onOpenBot={onClose} />;
        if (snapshot == null) return (
          <div aria-live="polite" role={error == null ? "status" : "alert"}>
            {error == null ? null : <>
              <span>{error}</span>
              <SandButton aria-label="Retry" onClick={() => setReload((value) => value + 1)} size="sm" variant="secondary">{SETTINGS_FALLBACK_LABELS.retry}</SandButton>
            </>}
          </div>
        );
        if (section === "general") return (
          <GeneralSettingsPanel
            onOpenConnectionSection={selectSection}
            account={snapshot.account}
            autoReview={{
              settings: snapshot.autoReview,
              onChange: (settings) => mutate(() => saveAutoReviewSettings(bridge, settings), "settings-auto-review", updateAutoReview)
            }}
            accountError={snapshot.accountError}
            accountPending={snapshot.accountPending}
            platform={bridge.platform === "win32" ? "windows" : "mac"}
            onAccountAction={() => {
              setSnapshot((current) => current == null ? current : { ...current, accountPending: true, accountError: null });
              void mutate(() => runAccountAction(bridge, snapshot.account), "settings-account", (status) => {
                setSnapshot((current) => current == null ? current : {
                  ...current,
                  account: accountStateFromCursorStatus(status, current.account.kind === "logged-in" ? current.account.avatarDataUrl : undefined),
                  accountPending: false,
                  accountError: status.kind === "logged-out" ? status.errorMessage ?? null : null
                });
              }).catch((reason: unknown) => {
                setSnapshot((current) => current == null ? current : {
                  ...current,
                  accountPending: false,
                  accountError: cursorAuthErrorMessage(reason)
                });
              });
            }}
            onThemeChange={(theme) => mutate(() => setThemePreference(bridge, theme), "settings-theme", (state) => updateTheme(state.preference))}
            localToolPermission={{
              state: snapshot.localToolPermission,
              onChange: (permission) => mutate(() => setLocalToolPermission(bridge, permission), "settings-local-tool-permission", updateLocalToolPermission)
            }}
            securityKey={{
              enabled: snapshot.securityKeyEnabled,
              onChange: (enabled) => mutate(() => setSecurityKeyEnabled(bridge, enabled), "settings-security-key", updateSecurityKey),
              platform: bridge.platform
            }}
            timeZone={{
              state: snapshot.timeZone,
              onChange: (timeZone) => mutate(() => setTimeZoneOverride(bridge, timeZone), "settings-time-zone", updateTimeZone)
            }}
            theme={snapshot.theme}
            language={uiLanguage}
            onLanguageChange={async (next) => {
              setUiLanguage(next);
              await bridge.agent.setUiLanguage?.(next);
            }}
          />
        );
        if (section === "usage") return (
          <UsageSettingsPanel
            meters={usageMetersFromSummary(snapshot.usageSummary)}
            onCancelDialogOpen={handleCancelTrialDialogOpen}
            onCancelTrial={() => mutate(() => cancelUsageTrial(bridge), "settings-usage-cancel-trial", (usage) => {
              if (usage.ok) refreshUsage();
            })}
            onRetry={refreshUsage}
            onUpgrade={(action) => runUsageUpgradeActionAndRefresh(bridge, action, refreshUsage)}
            state={snapshot.usage}
            provider={routerProvider}
          />
        );
        if (section === "router") return (
          <RouterSettingsPanel
            vendorAccounts={{
              vendors: vendorAccounts.vendors,
              defaultVendorId: vendorAccounts.defaultVendorId,
              pending: vendorAccountsPending,
              error: vendorAccountsError,
              language: uiLanguage,
              onAdd: async (input) => {
                setVendorAccountsPending(true);
                setVendorAccountsError(null);
                try {
                  const listed = await bridge.agent.upsertInferenceVendor({
                    ...(input.id == null ? {} : { id: input.id }),
                    label: input.label,
                    provider: input.provider,
                    apiKey: input.apiKey,
                    baseUrl: input.baseUrl,
                    modelId: input.modelId
                  });
                  setVendorAccounts({ vendors: [...(listed?.vendors ?? [])], defaultVendorId: listed?.defaultVendorId ?? null });
                } catch (reason) {
                  const message = reason instanceof Error ? reason.message : String(reason);
                  setVendorAccountsError(message);
                  throw reason;
                } finally {
                  setVendorAccountsPending(false);
                }
              },
              onRemove: async (id) => {
                setVendorAccountsPending(true);
                setVendorAccountsError(null);
                try {
                  const listed = await bridge.agent.deleteInferenceVendor(id);
                  setVendorAccounts({ vendors: [...(listed?.vendors ?? [])], defaultVendorId: listed?.defaultVendorId ?? null });
                } catch (reason) {
                  const message = reason instanceof Error ? reason.message : String(reason);
                  setVendorAccountsError(message);
                } finally {
                  setVendorAccountsPending(false);
                }
              },
              onMakeDefault: async (account) => {
                setVendorAccountsPending(true);
                setVendorAccountsError(null);
                try {
                  const listed = await bridge.agent.upsertInferenceVendor({
                    id: account.id,
                    label: account.label,
                    provider: account.provider,
                    baseUrl: account.baseUrl,
                    modelId: account.modelId,
                    makeDefault: true
                  });
                  setVendorAccounts({ vendors: [...(listed?.vendors ?? [])], defaultVendorId: listed?.defaultVendorId ?? null });
                } catch (reason) {
                  const message = reason instanceof Error ? reason.message : String(reason);
                  setVendorAccountsError(message);
                } finally {
                  setVendorAccountsPending(false);
                }
              }
            }}
            http={{
              apiKey: routerHttp.apiKey,
              baseUrl: routerHttp.baseUrl,
              modelId: routerHttp.modelId,
              onApiKeyChange: (value) => setRouterHttp((current) => ({ ...current, apiKey: value })),
              onBaseUrlChange: (value) => setRouterHttp((current) => ({ ...current, baseUrl: value })),
              onModelIdChange: (value) => setRouterHttp((current) => ({ ...current, modelId: value })),
              onSave: async () => {
                setRouterPending(true);
                try {
                  await bridge.agent.setInferenceRouter({
                    provider: routerProvider,
                    apiKey: routerHttp.apiKey,
                    baseUrl: routerHttp.baseUrl,
                    modelId: routerHttp.modelId
                  });
                  await saveRouterProvider(bridge.agent.clientPersistence, routerProvider);
                } catch (reason) {
                  const message = reason instanceof Error ? reason.message : String(reason);
                  publishSurfaceNotice({ kind: "error", operation: "settings-router-provider", message }, handleNotice, onStatus);
                } finally {
                  setRouterPending(false);
                }
              }
            }}
            onChange={async (provider) => {
              if (routerPending || provider === routerProvider) return;
              const previous = routerProvider;
              setRouterProvider(provider);
              const http = HTTP_ROUTER_PROVIDERS.find((item) => item.id === provider);
              if (http != null) setRouterHttp((current) => ({ ...current, baseUrl: http.defaultBaseUrl, modelId: http.defaultModelId }));
              setRouterPending(true);
              try {
                await bridge.agent.setInferenceRouter({ provider });
                await saveRouterProvider(bridge.agent.clientPersistence, provider);
              } catch (reason) {
                setRouterProvider(previous);
                const message = reason instanceof Error ? reason.message : String(reason);
                publishSurfaceNotice({ kind: "error", operation: "settings-router-provider", message }, handleNotice, onStatus);
              } finally {
                setRouterPending(false);
              }
            }}
            pending={routerPending}
            provider={routerProvider}
          />
        );
        return (
          <UpdatesSettingsPanel
            autoUpdateWhenIdle={snapshot.update?.autoUpdateWhenIdleOptIn ?? false}
            availableTracks={snapshot.update?.availableTracks ?? []}
            onCheck={() => checkForUpdatesWithRecovery(bridge, updateSnapshot).catch((reason: unknown) => {
              const message = reason instanceof Error ? reason.message : String(reason);
              publishSurfaceNotice({ kind: "error", operation: "settings-update-check", message }, handleNotice, onStatus);
              throw reason;
            })}
            onInstall={() => mutate(() => installUpdate(bridge), "settings-update-install", () => {})}
            onSetAutoUpdateWhenIdle={(enabled) => mutate(() => bridge.update.setAutoUpdateWhenIdleOptIn(enabled), "settings-update-auto-update-when-idle", updateSnapshot)}
            onSetTrack={(track) => mutate(() => bridge.update.setTrack(track), "settings-update-track", updateSnapshot)}
            egressTunnel={{
              available: snapshot.egressTunnel.available,
              enabled: snapshot.egressTunnel.enabled,
              featureGateEnabled: snapshot.egressTunnel.featureGateEnabled,
              onChange: (enabled) => setEgressTunnelEnabled(bridge, enabled).then((nextEnabled) => {
                setSnapshot((current) => current == null ? current : {
                  ...current,
                  egressTunnel: { ...current.egressTunnel, enabled: nextEnabled }
                });
                return nextEnabled;
              }),
              status: snapshot.egressTunnel.status
            }}
            computer={computer}
            status={snapshot.update}
          />
        );
      }}
      showUsage={snapshot != null && (routerProvider !== "cursor" || shouldShowUsageSettings(snapshot.usagePageFeatureGateEnabled, snapshot.usage))}
      iconPlatform={bridge.platform === "win32" ? "windows" : "mac"}
      closeOnBackdrop={!cancelTrialDialogOpen}
      closeOnEscape={!cancelTrialDialogOpen}
      trapFocus={!cancelTrialDialogOpen}
      />
    </>
  );
}
