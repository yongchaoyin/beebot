import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import * as acorn from "acorn";
import createIgnore from "ignore";

import { resolvePackagedAppArtifacts } from "../scripts/lib/packaged-app.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("packaged verification authority is the selected app bundle", () => {
  const appPath = path.join(repoRoot, "dist", "Example.app");
  const artifacts = resolvePackagedAppArtifacts(appPath);
  assert.equal(artifacts.appPath, appPath);
  assert.equal(artifacts.asarPath, path.join(appPath, "Contents", "Resources", "app.asar"));
  assert.equal(artifacts.unpackedPath, `${artifacts.asarPath}.unpacked`);
  assert.notEqual(artifacts.asarPath, path.join(repoRoot, ".build", "app.asar"));
  assert.throws(() => resolvePackagedAppArtifacts(path.join(repoRoot, ".build", "app.asar")), /\.app bundle/);
});

test("publication ignore rules retain reconstructed frontend source", async () => {
  const ignoreRules = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
  assert.match(ignoreRules, /^\/recovered\/$/m);
  assert.doesNotMatch(ignoreRules, /^recovered\/$/m);
  const retained = "frontend/src/recovered/ui/sand-form-primitives.css";
  const matcher = createIgnore().add(ignoreRules);
  assert.equal(matcher.ignores(retained), false, `${retained} must remain addable in a fresh repository`);
  assert.equal(matcher.ignores("recovered/generated-output.txt"), true, "root recovery output must remain ignored");
});

test("landing about wrap does not throw on a frozen desktop bridge", async () => {
  const { LANDING_ABOUT_WRAP } = await import(pathToFileURL(path.join(repoRoot, "scripts/lib/router-renderer-patch.mjs")).href);
  const window = {
    desktop: Object.freeze({
      onOpenAbout() {
        return () => {};
      },
    }),
  };
  assert.doesNotThrow(() => {
    vm.runInNewContext(LANDING_ABOUT_WRAP, {
      window,
      Object,
      setInterval,
      setTimeout,
      clearInterval,
    });
  });
  assert.equal(window.__sandAboutWrapped, 1);
});

test("landing create-overlay and account-menu snippets parse together", async () => {
  const createOverlay = await readFile(path.join(repoRoot, "scripts", "lib", "sand-create-overlay.snippet.js"), "utf8");
  const accountMenu = await readFile(path.join(repoRoot, "scripts", "lib", "sand-account-menu.snippet.js"), "utf8");
  const groupUi = await readFile(path.join(repoRoot, "scripts", "lib", "sand-group-ui.snippet.js"), "utf8");
  const monAt = createOverlay.indexOf("function MOn(");
  assert.ok(monAt > 0);
  const combined = `${createOverlay.slice(0, monAt)}\n${accountMenu}\n${groupUi}\n`;
  try {
    acorn.parse(combined, { ecmaVersion: 2022, sourceType: "module" });
  } catch (error) {
    assert.fail(String(error));
  }
});

test("default packaging keeps the polished checksum-pinned renderer", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "package-macos.mjs"), "utf8");
  assert.match(source, /import \{ buildFidelityReconstructedAsar \} from "\.\/clean-build\.mjs"/);
  assert.match(source, /await buildFidelityReconstructedAsar\(\)/);
  assert.match(source, /beebot-app-icon\.icns/);
  assert.match(source, /CFBundleIconName/);
});

test("Router settings use the trusted backend and display recorded inference usage", async () => {
  const rendererPatch = await readFile(path.join(repoRoot, "scripts", "lib", "router-renderer-patch.mjs"), "utf8");
  const createOverlay = await readFile(path.join(repoRoot, "scripts", "lib", "sand-create-overlay.snippet.js"), "utf8");
  const vendorAccounts = await readFile(path.join(repoRoot, "scripts", "lib", "sand-vendor-accounts.snippet.js"), "utf8");
  const preload = await readFile(path.join(repoRoot, "source", "electron-preload", "preload.ts"), "utf8");
  const mainEdge = await readFile(path.join(repoRoot, "source", "electron-main", "main-edge.ts"), "utf8");
  const inference = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "inference-service.ts"), "utf8");
  const inferenceExt = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "extension.ts"), "utf8");
  const cursorSession = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "cursor-session.ts"), "utf8");
  const cursorBackend = await readFile(path.join(repoRoot, "source", "shared", "node", "cursor-backend", "cursor-inference.ts"), "utf8");
  const providers = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "provider-session.ts"), "utf8");
  const vendor = await readFile(path.join(repoRoot, "source", "shared", "inference-vendor.ts"), "utf8");
  const codexDirect = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "codex-direct-responses.ts"), "utf8");
  const turnShell = await readFile(path.join(repoRoot, "source", "host", "runner", "turn-run-shell.ts"), "utf8");
  const coordinator = await readFile(path.join(repoRoot, "source", "node-agent-coordinator", "inference-router.ts"), "utf8");
  const coordinatorMain = await readFile(path.join(repoRoot, "source", "node-agent-coordinator", "main.ts"), "utf8");
  const mcpBridge = await readFile(path.join(repoRoot, "source", "node-agent-coordinator", "routed-mcp-bridge.ts"), "utf8");
  const localDocker = await readFile(path.join(repoRoot, "source", "electron-main", "box", "local-docker-host-connector.ts"), "utf8");
  assert.match(rendererPatch, /desktop\.agent\.getInferenceRouter\(\)/);
  assert.match(rendererPatch, /desktop\.agent\.setInferenceRouter\(n\)/);
  assert.match(rendererPatch, /desktop\.agent\.getBoxRuntime\(\)/);
  assert.match(rendererPatch, /desktop\.agent\.setBoxRuntime\(r\)/);
  assert.match(rendererPatch, /role:"switch"/);
  assert.match(rendererPatch, /Use local Docker VM/);
  assert.match(rendererPatch, /onValueChange:l=>\{if\(l!==null\)void e\(l\)\}/);
  assert.match(rendererPatch, /desktop\.agent\.setInferenceRouter\(\{provider:/);
  assert.doesNotMatch(rendererPatch, /settings\.router-provider\.v1/);
  assert.match(rendererPatch, /Usage for /);
  assert.match(rendererPatch, /Requests/);
  assert.match(rendererPatch, /Input tokens/);
  assert.match(rendererPatch, /Last used/);
  assert.match(rendererPatch, /Tracked activity/);
  assert.match(rendererPatch, /RRouterProviders\.filter/);
  assert.match(preload, /getInferenceRouter: \(\) => edge\("getInferenceRouter"\)/);
  assert.match(preload, /getUiLanguage: \(\) => edge\("getUiLanguage"\)/);
  assert.match(preload, /getInferenceVendors: \(\) => edge\("getInferenceVendors"\)/);
  assert.match(preload, /upsertInferenceVendor/);
  assert.match(preload, /deleteInferenceVendor/);
  assert.match(mainEdge, /upsertInferenceVendor/);
  assert.match(mainEdge, /vendorAccountSecretKey/);
  assert.match(preload, /getBoxRuntime: \(\) => edge\("getBoxRuntime"\)/);
  assert.match(preload, /setBoxRuntime: \(mode: string\) => edge\("setBoxRuntime", \{ mode \}\)/);
  assert.match(mainEdge, /syncHostSettingsToBox\(\{\s*inferenceProvider: provider,/);
  assert.match(mainEdge, /invoke\(deps\.settingsStore, "setInferenceProvider", provider\)/);
  assert.match(mainEdge, /return \{ provider, usage:/);
  assert.match(mainEdge, /invoke\(deps\.boxRecovery, "restartCoordinator"\)/);
  assert.match(mainEdge, /mode === "local-docker"\) await startLocalDockerBox\(settingsPath\); else await stopLocalDockerBox\(\)/);
  assert.match(mainEdge, /setBoxRuntime", mode === "local-docker" \? "remote" : "local-docker"/);
  assert.match(localDocker, /public\.ecr\.aws\/k0i0n2g5\/cursorenvironments\/universal:sand-box-latest/);
  assert.match(localDocker, /"127\.0\.0\.1:1340:1340"/);
  assert.match(localDocker, /LOCAL_DOCKER_SCHEMA_VERSION = "8"/);
  assert.match(localDocker, /LOCAL_INFERENCE_SNAPSHOT_ENV/);
  assert.match(localDocker, /dst=\$\{LOCAL_INFERENCE_MOUNT\},readonly/);
  assert.doesNotMatch(localDocker, /dst=\/home\/box\/sand-data\/settings.json/);
  assert.doesNotMatch(localDocker, /dst=\/home\/box\/sand-data\/box-secrets.json/);
  assert.match(localDocker, /SAND_BOX_AUTO_UPDATE=0/);
  assert.match(localDocker, /dst=\/home\/box\/sand-host\/host-main\.cjs,readonly/);
  assert.match(localDocker, /\.getBoxRuntime\(\) === "local-docker" \? await localConnect\(\) : await remote\.connect\(\)/);
  assert.match(inference, /recordInferenceUsage\(provider/);
  assert.match(inference, /resolveInferenceForAgent/);
  assert.match(inference, /typeof extendedUsage\.then === "function"/);
  assert.match(inference, /createProviderPromptSession\(routed\.provider, routed\.vendor\)/);
  assert.match(inferenceExt, /getInferenceProvider\(\) !== "cursor"/);
  assert.match(inferenceExt, /cursorWeb \? \{ createWebSearch/);
  assert.match(providers, /https:\/\/chatgpt\.com\/backend-api\/codex/);
  assert.match(providers, /headers\.set\("ChatGPT-Account-Id", credentials\.accountId\)/);
  assert.match(providers, /streamCodexDirectResponses/);
  assert.doesNotMatch(providers, /provider\.responses\(configuredCodexModel\(\)\)/);
  assert.match(codexDirect, /store: false/);
  assert.match(codexDirect, /response\.output_text\.delta/);
  assert.match(codexDirect, /type: "function_call_output"/);
  assert.match(providers, /resolveHttpToolParameters\(definition\.inputSchema \?\? definition\.parameters\)/);
  assert.match(providers, /your own Linux computer/);
  assert.match(providers, /If a SendMessage tool is available/);
  assert.match(providers, /hostSuppliedTools/);
  assert.doesNotMatch(providers, /withSyntheticSendMessage/);
  assert.match(providers, /fullStream: result\.fullStream/);
  assert.match(providers, /resolveHttpToolParameters/);
  assert.match(providers, /mcpServers: \{ grok_bot_plugins:/);
  assert.match(providers, /recordRoutedUsage\(provider, usage\)/);
  assert.match(providers, /queryClaude/);
  assert.match(providers, /tools: mcpServerUrl == null \? \[\] : \["mcp__grok_bot_plugins__\*"\]/);
  assert.match(vendor, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(providers, /Add it in Settings/);
  assert.match(providers, /preset\.secretKey/);
  assert.match(cursorSession, /resolveInferenceForAgent/);
  assert.match(cursorSession, /routed\.provider !== "cursor"/);
  assert.match(cursorSession, /createProviderPromptSession\(routed\.provider, routed\.vendor\)/);
  assert.match(cursorBackend, /routedProvider !== "cursor"/);
  assert.match(cursorBackend, /createProviderPromptSession\(routedProvider\)/);
  assert.doesNotMatch(rendererPatch, /ANTHROPIC_API_KEY/);
  assert.match(rendererPatch, /OPENAI_API_KEY/);
  assert.match(rendererPatch, /Choose a model vendor, paste an API key, and start/);
  assert.match(rendererPatch, /Start using/);
  assert.match(rendererPatch, /border:"1px solid #c8c8c8"/);
  assert.match(rendererPatch, /color:"#111"/);
  assert.match(rendererPatch, /color:"#333"/);
  assert.doesNotMatch(rendererPatch, /border:"1px solid rgba\(255,255,255/);
  assert.match(createOverlay, /__sandPickCreateBot/);
  assert.match(createOverlay, /新建群聊/);
  assert.match(createOverlay, /Get started/);
  assert.match(createOverlay, /__sandPickCreateGroup/);
  assert.match(createOverlay, /applyReady/);
  assert.match(createOverlay, /RBotSvg/);
  assert.match(createOverlay, /linearGradient/);
  assert.match(createOverlay, /inferenceVendorId/);
  assert.match(createOverlay, /getInferenceVendors/);
  assert.match(createOverlay, /sand-agent-vendor/);
  assert.match(createOverlay, /RAgentVendorId/);
  assert.match(createOverlay, /__sandRoster/);
  const accountMenu = await readFile(path.join(repoRoot, "scripts", "lib", "sand-account-menu.snippet.js"), "utf8");
  const main = await readFile(path.join(repoRoot, "source", "electron-main", "main.ts"), "utf8");
  assert.match(accountMenu, /__sandAccountMenuBound/);
  assert.match(accountMenu, /配置 AI/);
  assert.match(accountMenu, /sand-open-settings/);
  assert.match(accountMenu, /document\.dispatchEvent\(new KeyboardEvent\("keydown"/);
  assert.match(accountMenu, /getUiLanguage/);
  assert.match(accountMenu, /__sandOpenAboutOverlay/);
  assert.match(accountMenu, /sand-settings-nav__item/);
  assert.match(accountMenu, /\["Router","路由"\]/);
  assert.match(accountMenu, /\["General","通用"\]/);
  assert.match(accountMenu, /includes\(label\)/);
  assert.match(rendererPatch, /sand-account-menu\.snippet\.js/);
  assert.match(rendererPatch, /sand-group-ui\.snippet\.js/);
  assert.match(rendererPatch, /sand-open-settings/);
  assert.match(rendererPatch, /sand-open-about/);
  assert.match(rendererPatch, /sand-settings-nav__item/);
  assert.match(rendererPatch, /includes\(label\)/);
  assert.match(main, /settingsStore\?\.getUiLanguage/);
  assert.match(vendorAccounts, /Model APIs/);
  assert.match(vendorAccounts, /Add model/);
  assert.match(vendorAccounts, /Edit model/);
  assert.match(vendorAccounts, /upsertInferenceVendor/);
  assert.match(vendorAccounts, /deleteInferenceVendor/);
  assert.match(vendorAccounts, /RVendorInput/);
  assert.match(createOverlay, /data-agent-id/);
  const vendorUpdate = createOverlay.match(/sel\.onchange=\(\)=>\{([\s\S]*?)\n  \};/);
  assert.ok(vendorUpdate, "existing Bot vendor updates remain wired");
  assert.doesNotMatch(vendorUpdate[1], /description\s*:/);
  assert.match(rendererPatch, /Model APIs/);
  assert.match(rendererPatch, /sand-vendor-accounts\.snippet\.js/);
  assert.match(mainEdge, /This vendor needs a Base URL and model ID/);
  const languageRuntime = await readFile(path.join(repoRoot, "scripts", "lib", "ui-language-runtime.snippet.js"), "utf8");
  assert.match(languageRuntime, /desktop\.agent\.getUiLanguage\(\)/);
  assert.match(languageRuntime, /desktop\.agent\.setUiLanguage\(next\)/);
  assert.match(rendererPatch, /__beebotUiLanguage/);
  assert.match(rendererPatch, /patchUiLanguageRenderer/);
  assert.match(rendererPatch, /RLanguageRow/);
  assert.match(turnShell, /inferenceProvider === "cursor"/);
  assert.match(turnShell, /resolveInferenceForAgent/);
  assert.match(turnShell, /createProviderPromptSession\(inferenceProvider, routed\.vendor\)/);
  assert.match(coordinator, /method !== "sendPrompt" \|\| provider === "cursor" \|\| isHttpInferenceVendor\(provider\)/);
  assert.match(coordinator, /executeTool: async \(definition, toolArgs, toolCallId\)/);
  assert.match(coordinatorMain, /command\(commands, "listRoutedMcpTools", args\)/);
  assert.match(coordinator, /inference-router-transcript\.json/);
  assert.match(mcpBridge, /openWorldHint: !readOnly/);
  assert.match(coordinator, /schemaVersion: 2/);
  assert.match(coordinator, /\["getAgentTranscriptTail", "openAgentTail", "getAgentTranscriptWindow"\]/);
  assert.match(coordinator, /\.map\(projectInferenceRouterTranscriptEntry\)/);
  assert.match(coordinator, /readonly richText\?: string/);
  assert.match(coordinator, /richText: entry\.richText/);
  assert.match(coordinator, /setTimeout\(resolve, 1_200\)/);
  assert.match(coordinator, /method === "reactToMessage"/);
  assert.match(coordinator, /reaction\.by === "me"/);
  assert.match(coordinator, /currentActivity: \{ kind: "thinking" \}/);
  assert.match(coordinator, /onTextDelta/);
  assert.match(coordinator, /streaming/);
  assert.match(coordinator, /postEvent\("agents"/);
  assert.match(coordinator, /createRoutedMcpBridge/);
  assert.match(coordinator, /listRoutedMcpTools/);
  assert.match(coordinator, /executeRoutedMcpTool/);
  assert.match(mcpBridge, /server\.listen\(0, "127\.0\.0\.1"/);
  assert.match(mcpBridge, /readOnlyHint: readOnly/);
  assert.match(mcpBridge, /request\.url !== `\/mcp\/\$\{secret\}`/);
  assert.match(coordinator, /kind: "send-message"/);
  assert.match(coordinatorMain, /createCoordinatorInferenceRouter/);
  assert.match(coordinatorMain, /routed\.handled/);
});
