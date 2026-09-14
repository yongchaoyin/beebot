# BeeBot Account Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the official Grok Bot account menu and macOS Help entries with BeeBot’s five items: Settings, Configure AI, About, Documentation, Feedback.

**Architecture:** Shared copy and GitHub URLs live in `source/shared/ui-language.ts`. The packaged renderer gets a snippet injected next to the create-bot overlay that rewrites the sidebar account dropdown. Recovered `AccountMenu` and `ProductionRenderer` expose the same five actions. `buildApplicationMenuTemplate` rebuilds Help from that copy when Settings language changes.

**Tech Stack:** TypeScript, Electron application menu, original-renderer JS snippet via `router-renderer-patch.mjs`, recovered React, `node --test` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-09-14-botfly-account-menu-design.md`

## Global Constraints

- Copy follows Settings language (`en` / `zh`), not the OS locale.
- Documentation English: `https://github.com/yongchaoyin/beebot/blob/main/README.md`
- Documentation 中文: `https://github.com/yongchaoyin/beebot/blob/main/README.zh.md`
- Feedback: `https://github.com/yongchaoyin/beebot/issues/new`
- Settings opens section `general`; Configure AI opens section `router`.
- Remove iOS, Help Center, official Send Feedback, Log out, Sign in, Cursor usage from these menus.
- Local identity chip stays; no sign-out path on the local account menu.
- Do not edit the immutable 0.18 bundle by hand; inject through `scripts/lib/router-renderer-patch.mjs`.
- Official rows must not remain in the sidebar account dropdown DOM.
- macOS Help must not contain `cursor.com/help` or emit `open-feedback`.
- Group-mode work is out of scope. Keep the create-group overlay fix on this branch independent.
- TDD: failing test first, then minimal code. Tests: `node --test tests/<file>.test.mjs`.

## File map

| File | Role |
| --- | --- |
| `source/shared/ui-language.ts` | `accountMenuCopy`, documentation/feedback URLs |
| `source/electron-main/application-menu.ts` | Help submenu + language |
| `source/electron-main/main-edge.ts` | Rebuild Help after `setUiLanguage` |
| `source/electron-main/main.ts` | Pass language into `installApplicationMenu` |
| `scripts/lib/sand-account-menu.snippet.js` | Packaged sidebar menu |
| `scripts/lib/router-renderer-patch.mjs` | Inject snippet + `sand-open-settings` |
| `frontend/src/recovered/features/account/session/account-menu-copy.ts` | Recovered copy table (mirrors shared) |
| `frontend/src/recovered/features/account/session/menu.tsx` | Five-item React menu |
| `frontend/src/production/ProductionRenderer.tsx` | Wire callbacks |
| `tests/ui-language.test.mjs` | Copy + URLs |
| `tests/application-menu.test.mjs` | Help template |
| `tests/account-menu-overlay.test.mjs` | Snippet behavior |
| `tests/account-menu.test.mjs` | Recovered item list |
| `tests/publication-packaging.test.mjs` | Snippet is patched in |

---

### Task 1: Shared copy and GitHub URLs

**Files:**
- Modify: `source/shared/ui-language.ts`
- Test: `tests/ui-language.test.mjs`

**Interfaces:**
- Consumes: existing `UiLanguage`, `createBotCopy`
- Produces:
  - `accountMenuCopy(language: UiLanguage): { settings, configureAi, about, documentation, feedback, openFailed }`
  - `beebotDocumentationUrl(language: UiLanguage): string`
  - `BEEBOT_FEEDBACK_URL: string` = `https://github.com/yongchaoyin/beebot/issues/new`

- [ ] **Step 1: Write the failing test**

Add to `tests/ui-language.test.mjs`:

```js
test("account menu copy and GitHub destinations follow Settings language", async () => {
  const language = await load();
  assert.deepEqual(language.accountMenuCopy("en"), {
    settings: "Settings",
    configureAi: "Configure AI",
    about: "About",
    documentation: "Documentation",
    feedback: "Feedback",
    openFailed: "Couldn't open that link.",
  });
  assert.deepEqual(language.accountMenuCopy("zh"), {
    settings: "设置",
    configureAi: "配置 AI",
    about: "关于",
    documentation: "文档",
    feedback: "反馈",
    openFailed: "无法打开该链接。",
  });
  assert.equal(
    language.beebotDocumentationUrl("en"),
    "https://github.com/yongchaoyin/beebot/blob/main/README.md",
  );
  assert.equal(
    language.beebotDocumentationUrl("zh"),
    "https://github.com/yongchaoyin/beebot/blob/main/README.zh.md",
  );
  assert.equal(
    language.BEEBOT_FEEDBACK_URL,
    "https://github.com/yongchaoyin/beebot/issues/new",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ui-language.test.mjs`

Expected: FAIL — `accountMenuCopy` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `source/shared/ui-language.ts` add:

```ts
export const BEEBOT_FEEDBACK_URL = "https://github.com/yongchaoyin/beebot/issues/new";

export function beebotDocumentationUrl(language: UiLanguage): string {
  return language === "zh"
    ? "https://github.com/yongchaoyin/beebot/blob/main/README.zh.md"
    : "https://github.com/yongchaoyin/beebot/blob/main/README.md";
}

export interface AccountMenuCopy {
  readonly settings: string;
  readonly configureAi: string;
  readonly about: string;
  readonly documentation: string;
  readonly feedback: string;
  readonly openFailed: string;
}

export function accountMenuCopy(language: UiLanguage): AccountMenuCopy {
  if (language === "zh") {
    return {
      settings: "设置",
      configureAi: "配置 AI",
      about: "关于",
      documentation: "文档",
      feedback: "反馈",
      openFailed: "无法打开该链接。",
    };
  }
  return {
    settings: "Settings",
    configureAi: "Configure AI",
    about: "About",
    documentation: "Documentation",
    feedback: "Feedback",
    openFailed: "Couldn't open that link.",
  };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test tests/ui-language.test.mjs`

Expected: PASS (existing create-bot test + new test).

- [ ] **Step 5: Commit**

```bash
git add source/shared/ui-language.ts tests/ui-language.test.mjs
git commit -m "Add BeeBot account menu copy and GitHub URLs."
```

---

### Task 2: macOS Help menu

**Files:**
- Modify: `source/electron-main/application-menu.ts`
- Modify: `source/electron-main/main.ts` (pass `uiLanguage`, drop `emitOpenFeedback` from Help)
- Modify: `source/electron-main/main-edge.ts` (`setUiLanguage` rebuilds the menu)
- Create: `tests/application-menu.test.mjs`

**Interfaces:**
- Consumes: `accountMenuCopy`, `beebotDocumentationUrl`, `BEEBOT_FEEDBACK_URL`, `parseUiLanguage`
- Produces: `buildApplicationMenuTemplate(options, electron)` Help submenu with Documentation + Feedback; `ApplicationMenuOptions.uiLanguage?: UiLanguage`; `registerApplicationMenuRebuild(hook)` / `requestApplicationMenuRebuild()`

- [ ] **Step 1: Write the failing test**

Create `tests/application-menu.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load() {
  const source = await readFile(path.join(repoRoot, "source/electron-main/application-menu.ts"), "utf8");
  const { code } = await transform(source, {
    format: "esm",
    loader: "ts",
    target: "es2022",
    sourcefile: "application-menu.ts",
  });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function helpItems(template) {
  const help = template.find((item) => item.role === "help");
  return help?.submenu ?? [];
}

test("Help menu opens BeeBot docs and GitHub issues, not cursor.com", async () => {
  const menu = await load();
  const opened = [];
  const electron = {
    appName: "BeeBot",
    openExternal: async (url) => { opened.push(url); },
  };
  const en = helpItems(menu.buildApplicationMenuTemplate({
    applyWindowShortcut() {},
    canUseDevTools: () => false,
    emitOpenAbout() {},
    uiLanguage: "en",
    platform: "darwin",
  }, electron));
  assert.deepEqual(en.map((item) => item.label), ["Documentation", "Feedback"]);
  assert.equal(en.some((item) => item.label === "Help Center"), false);
  assert.equal(en.some((item) => item.label === "Send Feedback"), false);
  await en[0].click();
  await en[1].click();
  assert.deepEqual(opened, [
    "https://github.com/yongchaoyin/beebot/blob/main/README.md",
    "https://github.com/yongchaoyin/beebot/issues/new",
  ]);

  const zh = helpItems(menu.buildApplicationMenuTemplate({
    applyWindowShortcut() {},
    canUseDevTools: () => false,
    emitOpenAbout() {},
    uiLanguage: "zh",
    platform: "darwin",
  }, electron));
  assert.deepEqual(zh.map((item) => item.label), ["文档", "反馈"]);
  opened.length = 0;
  await zh[0].click();
  assert.equal(opened[0], "https://github.com/yongchaoyin/beebot/blob/main/README.zh.md");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/application-menu.test.mjs`

Expected: FAIL — Help still has Help Center / Send Feedback, or `uiLanguage` is ignored.

- [ ] **Step 3: Write minimal implementation**

`source/electron-main/application-menu.ts`:

- Import `accountMenuCopy`, `beebotDocumentationUrl`, `BEEBOT_FEEDBACK_URL`, `parseUiLanguage`, type `UiLanguage` from `../shared/ui-language.js`.
- Add `uiLanguage?: UiLanguage` to `ApplicationMenuOptions`. Remove `emitOpenFeedback` from the options interface (nothing else should call it from Help).
- Add:

```ts
let rebuildHook: (() => void) | null = null;
export function registerApplicationMenuRebuild(hook: () => void): void {
  rebuildHook = hook;
}
export function requestApplicationMenuRebuild(): void {
  rebuildHook?.();
}
```

- Help submenu:

```ts
const language = parseUiLanguage(options.uiLanguage);
const copy = accountMenuCopy(language);
template.push({
  role: "help",
  submenu: [
    {
      label: copy.documentation,
      click: () => { void electron.openExternal(beebotDocumentationUrl(language)); },
    },
    {
      label: copy.feedback,
      click: () => { void electron.openExternal(BEEBOT_FEEDBACK_URL); },
    },
  ],
});
```

Hook signature in `application-menu.ts`:

```ts
type RebuildFn = (language: UiLanguage) => void;
let rebuildHook: RebuildFn | null = null;
export function registerApplicationMenuRebuild(hook: RebuildFn): void {
  rebuildHook = hook;
}
export function requestApplicationMenuRebuild(language: UiLanguage): void {
  rebuildHook?.(language);
}
```

`source/electron-main/main.ts` — keep a `uiLanguage` closed over by `installMenu`. Default `parseUiLanguage(undefined)` (`en`). Register the rebuild hook so `setUiLanguage` can push the new language:

```ts
import { parseUiLanguage } from "../shared/ui-language.js";
import { installApplicationMenu, registerApplicationMenuRebuild } from "./application-menu.js";

let uiLanguage = parseUiLanguage(undefined);
const installMenu = (): void =>
  installApplicationMenu(
    {
      applyWindowShortcut: hostChords.applyWindowShortcut,
      canUseDevTools: devToolsGate.isAllowed,
      emitOpenAbout: () => services?.mainEdge.emit("open-about", {}),
      uiLanguage,
      platform,
    },
    deps.menu,
  );
installMenu();
registerApplicationMenuRebuild((next) => {
  uiLanguage = next;
  installMenu();
});
```

Remove the `emitOpenFeedback` argument from this call.

`source/electron-main/main-edge.ts` `setUiLanguage`:

```ts
setUiLanguage: (raw) => {
  const language = parseUiLanguage(req(raw).language);
  invoke(deps.settingsStore, "setUiLanguage", language);
  requestApplicationMenuRebuild(language);
  return { language };
},
```

Import `requestApplicationMenuRebuild` from `./application-menu.js`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test tests/application-menu.test.mjs tests/ui-language.test.mjs`

Expected: PASS. Also run `npm run source:typecheck` if `emitOpenFeedback` removal breaks `main.ts` — delete the `emitOpenFeedback` argument there.

- [ ] **Step 5: Commit**

```bash
git add source/electron-main/application-menu.ts source/electron-main/main.ts source/electron-main/main-edge.ts tests/application-menu.test.mjs
git commit -m "Point macOS Help at BeeBot docs and GitHub issues."
```

---

### Task 3: Packaged sidebar account menu snippet

**Files:**
- Create: `scripts/lib/sand-account-menu.snippet.js`
- Create: `tests/account-menu-overlay.test.mjs`

**Interfaces:**
- Consumes: copy table from Task 1 (duplicated in the snippet like `RUiCopy` in the create overlay)
- Produces: `window.__sandBindAccountMenu` behavior — `#sand-account-menu` with five buttons; `sand-open-settings` CustomEvent `{section:"general"|"router"}`; `sand-open-about` CustomEvent; `window.desktop.openExternal` for docs/feedback

The packaged app’s account dropdown is the original renderer. Intercept the footer account trigger (`.sand-agents-sidebar__account [aria-haspopup="menu"]`, fallback `.sand-agents-sidebar__account button`). `preventDefault` + `stopPropagation` in capture phase so the official menu never mounts. Render `#sand-account-menu` with the five rows.

Settings: `window.dispatchEvent(new CustomEvent("sand-open-settings", { detail: { section: "general" } }))` then a `keydown` for meta/ctrl + comma (existing `sand.openSettings`).

Configure AI: same with `section: "router"`.

About: `window.dispatchEvent(new CustomEvent("sand-open-about"))`.

Documentation / Feedback: `window.desktop.openExternal(url)`. On reject, show a 3s text toast with `copy.openFailed`.

- [ ] **Step 1: Write the failing test**

Create `tests/account-menu-overlay.test.mjs` using happy-dom, same bootstrap style as `tests/create-group-overlay.test.mjs` (`window.eval` of the snippet only).

Stub:

```js
window.desktop = {
  openExternal: async (url) => { opened.push(url); },
  agent: { getUiLanguage: async () => ({ language: "en" }) },
};
```

Fixture HTML:

```html
<div class="sand-agents-sidebar__account">
  <button aria-haspopup="menu" aria-label="Account">Local</button>
</div>
```

Tests:

1. Clicking the account button shows exactly `["Settings","Configure AI","About","Documentation","Feedback"]`. Assert no `Get Grok Bot for iOS`, `Help Center`, `Log out`, `Send Feedback`.
2. Click Configure AI → last `sand-open-settings` detail.section is `"router"`.
3. Click Settings → section `"general"`.
4. Click About → `sand-open-about` fired.
5. Click Documentation / Feedback → `openExternal` URLs match Task 1.
6. With `__sandUiLanguage = "zh"`, labels are 设置 / 配置 AI / 关于 / 文档 / 反馈.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/account-menu-overlay.test.mjs`

Expected: FAIL — file missing or `__sandBindAccountMenu` undefined.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/sand-account-menu.snippet.js`. Keep it self-contained (no `function MOn`). Mirror create-overlay style:

```js
function RAccountCopy(){
  const zh=(window.__sandUiLanguage||"en")==="zh";
  return zh?{
    settings:"设置",configureAi:"配置 AI",about:"关于",documentation:"文档",feedback:"反馈",
    openFailed:"无法打开该链接。"
  }:{
    settings:"Settings",configureAi:"Configure AI",about:"About",documentation:"Documentation",feedback:"Feedback",
    openFailed:"Couldn't open that link."
  };
}
function RAccountDocs(){return (window.__sandUiLanguage||"en")==="zh"?"https://github.com/yongchaoyin/beebot/blob/main/README.zh.md":"https://github.com/yongchaoyin/beebot/blob/main/README.md"}
function RAccountFeedback(){return "https://github.com/yongchaoyin/beebot/issues/new"}
function ROpenExternal(url,failed){
  const open=window.desktop&&window.desktop.openExternal;
  if(typeof open!=="function") return;
  Promise.resolve(open(url)).catch(()=>{
    const n=document.createElement("div");
    n.textContent=failed;
    n.style.cssText="position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:8px 12px;border-radius:8px;z-index:99999;font:13px system-ui";
    document.body.append(n);
    setTimeout(()=>n.remove(),3000);
  });
}
function ROpenSettings(section){
  window.dispatchEvent(new CustomEvent("sand-open-settings",{detail:{section:section||"general"}}));
  const meta=/Mac|iPhone|iPod|iPad/.test(navigator.platform);
  window.dispatchEvent(new KeyboardEvent("keydown",{key:",",code:"Comma",metaKey:meta,ctrlKey:!meta,bubbles:!0}));
}
function RHideAccountMenu(){document.getElementById("sand-account-menu")?.remove()}
function RShowAccountMenu(anchor){
  RHideAccountMenu();
  const copy=RAccountCopy();
  const menu=document.createElement("div");
  menu.id="sand-account-menu";
  const r=anchor.getBoundingClientRect();
  menu.style.cssText="position:fixed;bottom:"+Math.max(12,window.innerHeight-r.top+8)+"px;left:"+Math.max(12,r.left)+"px;z-index:99993;background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.16);padding:6px;min-width:220px;font-family:system-ui,-apple-system,sans-serif;color:#111";
  const row=(label,fn)=>{const b=document.createElement("button"); b.type="button"; b.textContent=label; b.style.cssText="display:block;width:100%;text-align:left;border:0;background:transparent;padding:10px 12px;border-radius:8px;cursor:pointer;font-size:14px"; b.onmouseenter=()=>b.style.background="#f4f4f2"; b.onmouseleave=()=>b.style.background="transparent"; b.onclick=()=>{RHideAccountMenu();fn()}; return b};
  menu.append(
    row(copy.settings,()=>ROpenSettings("general")),
    row(copy.configureAi,()=>ROpenSettings("router")),
    row(copy.about,()=>window.dispatchEvent(new Event("sand-open-about"))),
    row(copy.documentation,()=>ROpenExternal(RAccountDocs(),copy.openFailed)),
    row(copy.feedback,()=>ROpenExternal(RAccountFeedback(),copy.openFailed))
  );
  document.body.append(menu);
  const hide=e=>{if(!menu.contains(e.target)&&e.target!==anchor){RHideAccountMenu();document.removeEventListener("mousedown",hide)}};
  setTimeout(()=>document.addEventListener("mousedown",hide),0);
}
if(!window.__sandAccountMenuBound){
  window.__sandAccountMenuBound=!0;
  document.addEventListener("click",ev=>{
    const btn=ev.target&&ev.target.closest&&ev.target.closest(".sand-agents-sidebar__account [aria-haspopup='menu'], .sand-agents-sidebar__account button");
    if(!btn) return;
    ev.preventDefault(); ev.stopPropagation();
    RShowAccountMenu(btn);
  },true);
}
```

Use `sand-open-about` as `Event` or `CustomEvent` — tests should listen for the string `"sand-open-about"`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test tests/account-menu-overlay.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sand-account-menu.snippet.js tests/account-menu-overlay.test.mjs
git commit -m "Add BeeBot sidebar account menu overlay snippet."
```

---

### Task 4: Inject snippet and open Settings on Router

**Files:**
- Modify: `scripts/lib/router-renderer-patch.mjs`
- Modify: `tests/publication-packaging.test.mjs`

**Interfaces:**
- Consumes: `scripts/lib/sand-account-menu.snippet.js`
- Produces: snippet concatenated into `CREATE_AGENT_AFTER` (before `function MOn`); settings patch listens for `sand-open-settings` and `sand-open-about`

- [ ] **Step 1: Write the failing test**

In `tests/publication-packaging.test.mjs` next to the create-overlay matches:

```js
const accountMenu = await readFile(path.join(repoRoot, "scripts", "lib", "sand-account-menu.snippet.js"), "utf8");
assert.match(accountMenu, /__sandAccountMenuBound/);
assert.match(accountMenu, /配置 AI/);
assert.match(accountMenu, /sand-open-settings/);
assert.match(rendererPatch, /sand-account-menu\.snippet\.js/);
assert.match(rendererPatch, /sand-open-settings/);
assert.match(rendererPatch, /sand-open-about/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/publication-packaging.test.mjs`

Expected: FAIL — `router-renderer-patch.mjs` does not mention `sand-account-menu.snippet.js`.

- [ ] **Step 3: Write minimal implementation**

In `scripts/lib/router-renderer-patch.mjs`:

1. Read the account snippet next to the create overlay:

```js
const ACCOUNT_MENU_SNIPPET = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sand-account-menu.snippet.js"), "utf8");
```

2. Change `CREATE_AGENT_AFTER` to append the account snippet after the create overlay (still before original `function MOn` replacement, because `CREATE_AGENT_AFTER` *is* the replacement including `function MOn` from the create overlay file). The create overlay file already ends with `function MOn(...)`. Append `ACCOUNT_MENU_SNIPPET` **before** that file is inlined, i.e.:

```js
const CREATE_AGENT_AFTER = `const R_PATHS=${readFileSync(..., "persona-shape-paths.json")};\n${readFileSync(..., "sand-create-overlay.snippet.js")}\n${ACCOUNT_MENU_SNIPPET}`;
```

The create overlay file currently **ends** with the start of `function MOn`. Putting the account snippet after that would break `MOn`. **Insert the account snippet immediately before the `function MOn(` line inside the create overlay file is not required** — instead append `ACCOUNT_MENU_SNIPPET` in `CREATE_AGENT_AFTER` **between** the create overlay content and nothing else only if the create overlay is split.

Required order in the patched landing chunk:

```
R_PATHS = ...
<create overlay helpers including __sandPickCreateGroup>
<account menu snippet — complete statements only>
function MOn(n){ ... patched body ...
```

So: split the create overlay at `function MOn(`:

```js
const createOverlay = readFileSync(..., "sand-create-overlay.snippet.js"), "utf8");
const monAt = createOverlay.indexOf("function MOn(");
const CREATE_AGENT_AFTER = `const R_PATHS=${paths};\n${createOverlay.slice(0, monAt)}\n${ACCOUNT_MENU_SNIPPET}\n${createOverlay.slice(monAt)}`;
```

Do **not** change create-group behavior.

3. Listen for snippet events in `COMPONENT_HEAD`:

```js
if(!window.__sandOpenSettingsBound){
  window.__sandOpenSettingsBound=!0;
  window.addEventListener("sand-open-settings",ev=>{
    const section=ev&&ev.detail&&ev.detail.section==="router"?"router":"general";
    const clickNav=()=>{
      const labels=section==="router"?["Router","路由"]:["General","通用"];
      const nodes=[...document.querySelectorAll("button, [role=tab]")];
      const hit=nodes.find(el=>labels.includes((el.textContent||"").trim()));
      if(hit) hit.click();
    };
    setTimeout(clickNav,80);
    setTimeout(clickNav,240);
  });
  window.addEventListener("sand-open-about",()=>{
    const open=window.__sandOpenAboutOverlay;
    if(typeof open==="function") open();
  });
}
```

4. Capture the original About overlay opener. The original renderer calls `window.desktop.onOpenAbout(handler)` at boot. Wrap that method **before** the original subscribe runs. At the start of `patchOriginalLanding`’s returned source (after the three `replaceExactlyOnce` calls), prepend:

```js
;(function(){
  function wrap(){
    const d=window.desktop;
    if(!d||d.__sandAboutWrapped||typeof d.onOpenAbout!=="function") return false;
    const orig=d.onOpenAbout.bind(d);
    d.onOpenAbout=function(listener){
      window.__sandOpenAboutOverlay=listener;
      return orig(listener);
    };
    d.__sandAboutWrapped=1;
    return true;
  }
  if(!wrap()){
    const t=setInterval(()=>{ if(wrap()) clearInterval(t); },20);
    setTimeout(()=>clearInterval(t),8000);
  }
})();
```

Do not build a second About UI. Sidebar About dispatches `sand-open-about`; the wrapper calls the original listener; macOS **BeeBot → About BeeBot** still uses `emitOpenAbout`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test tests/publication-packaging.test.mjs tests/account-menu-overlay.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/router-renderer-patch.mjs tests/publication-packaging.test.mjs
git commit -m "Patch the original renderer with the BeeBot account menu."
```

---

### Task 5: Recovered React AccountMenu and ProductionRenderer

**Files:**
- Create: `frontend/src/recovered/features/account/session/account-menu-copy.ts`
- Modify: `frontend/src/recovered/features/account/session/menu.tsx`
- Modify: `frontend/src/production/ProductionRenderer.tsx`
- Create: `tests/account-menu.test.mjs`

**Interfaces:**
- Consumes: `accountMenuCopy` shape from Task 1; `beebotDocumentationUrl`; `BEEBOT_FEEDBACK_URL`
- Produces: `AccountMenu` props `onOpenConfigureAi`, `onOpenDocumentation`, `onOpenFeedback` (GitHub, not overlay); no `onOpenIos`, `onOpenHelp`, `onRequestLogout`, `onOpenUsage` in the rendered menu

- [ ] **Step 1: Write the failing test**

`tests/account-menu.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadCopy() {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/account/session/account-menu-copy.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

async function loadShared() {
  const source = await readFile(path.join(repoRoot, "source/shared/ui-language.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("recovered account menu copy matches shared BeeBot copy", async () => {
  const copy = await loadCopy();
  const shared = await loadShared();
  assert.deepEqual(copy.accountMenuCopy("en"), shared.accountMenuCopy("en"));
  assert.deepEqual(copy.accountMenuCopy("zh"), shared.accountMenuCopy("zh"));
  assert.deepEqual(copy.accountMenuActions(), ["settings", "configureAi", "about", "documentation", "feedback"]);
});

test("recovered AccountMenu source has no official rows", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/account/session/menu.tsx"), "utf8");
  assert.match(source, /onOpenConfigureAi/);
  assert.match(source, /accountMenuActions/);
  assert.doesNotMatch(source, /Get Grok Bot for iOS/);
  assert.doesNotMatch(source, /onOpenIos/);
  assert.doesNotMatch(source, /onRequestLogout/);
  assert.doesNotMatch(source, /Help Center/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/account-menu.test.mjs`

Expected: FAIL — `account-menu-copy.ts` missing.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/recovered/features/account/session/account-menu-copy.ts` — duplicate the Task 1 tables (frontend tsconfig cannot import `source/`). Export `accountMenuCopy`, `beebotDocumentationUrl`, `BEEBOT_FEEDBACK_URL`, and:

```ts
export const accountMenuActions = () =>
  ["settings", "configureAi", "about", "documentation", "feedback"] as const;
```

`menu.tsx`: drop iOS gate, usage block, logout, sign-in rows. Keep the account trigger (avatar + Local name) and `updatePill`. Render five `SandMenuItem`s from `accountMenuActions()` + `accountMenuCopy(language)`. New props:

```ts
language: "en" | "zh";
onOpenConfigureAi(): void;
onOpenDocumentation(): void;
onOpenFeedback(): void;
onOpenAbout(): void;
onOpenSettings(): void;
onError(message: string): void;
```

Remove unused props: `onOpenIos`, `onOpenHelp`, `onOpenUsage`, `onRequestLogout`, `experimentsSnapshot`, usage labels. Keep `bridge` only if the name editor still needs it. Spec: no sign-out path — remove the name-editor-only requirement? Keep `AccountNameEditor` when `displayName` is missing; it is not a menu row.

`ProductionRenderer.tsx` AccountMenu usage:

```tsx
<AccountMenu
  account={account}
  accountLabel={UI_TEXT.account}
  bridge={bridge}
  displayName={accountName(account)}
  isOpen={accountMenuOpen}
  language={uiLanguage}
  onError={setNotice}
  onOpenAbout={() => setOverlay("about")}
  onOpenChange={setAccountMenuOpen}
  onOpenConfigureAi={() => { setSettingsSection("router"); setManageSharedRoomId(null); setOverlay("settings"); }}
  onOpenDocumentation={() => { void bridge.openExternal(beebotDocumentationUrl(uiLanguage)).catch((reason) => setNotice(reason instanceof Error ? reason.message : String(reason))); }}
  onOpenFeedback={() => { void bridge.openExternal(BEEBOT_FEEDBACK_URL).catch((reason) => setNotice(reason instanceof Error ? reason.message : String(reason))); }}
  onOpenSettings={() => { setSettingsSection("general"); setManageSharedRoomId(null); setOverlay("settings"); }}
  onStatus={setAccount}
  updatePill={<UpdatePill bridge={bridge} labels={UPDATE_PILL_LABELS} />}
/>
```

Import `beebotDocumentationUrl` and `BEEBOT_FEEDBACK_URL` from `../recovered/features/account/session/account-menu-copy`.

Also listen for packaged events if this tree is ever hosted in a window that receives them:

```ts
useEffect(() => {
  const onAbout = () => setOverlay("about");
  const onSettings = (event: Event) => {
    const section = (event as CustomEvent<{ section?: string }>).detail?.section === "router" ? "router" : "general";
    setSettingsSection(section);
    setManageSharedRoomId(null);
    setOverlay("settings");
  };
  window.addEventListener("sand-open-about", onAbout);
  window.addEventListener("sand-open-settings", onSettings as EventListener);
  return () => {
    window.removeEventListener("sand-open-about", onAbout);
    window.removeEventListener("sand-open-settings", onSettings as EventListener);
  };
}, []);
```

This makes About work when the snippet fires `sand-open-about` inside the recovered renderer. The packaged original renderer still needs its own About overlay; the event is the seam.

Do not use `UI_TEXT.helpCenter` / `logOut` / `sendFeedback` as AccountMenu labels. Leave those keys in `evidence.ts` for the sign-out dialog and in-app feedback overlay if those still compile.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test tests/account-menu.test.mjs tests/ui-language.test.mjs`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS. Fix any leftover AccountMenu props in `ProductionRenderer.tsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/recovered/features/account/session/account-menu-copy.ts frontend/src/recovered/features/account/session/menu.tsx frontend/src/production/ProductionRenderer.tsx tests/account-menu.test.mjs
git commit -m "Switch recovered account menu to BeeBot items."
```

---

### Task 6: Full verification

**Files:** none new

- [ ] **Step 1: Run the focused tests**

Run: `node --test tests/ui-language.test.mjs tests/application-menu.test.mjs tests/account-menu-overlay.test.mjs tests/account-menu.test.mjs tests/publication-packaging.test.mjs tests/create-group-overlay.test.mjs`

Expected: all PASS. Create-group tests still pass (independent).

- [ ] **Step 2: Run the full unit suite and typechecks**

Run: `npm test && npm run typecheck && npm run source:typecheck`

Expected: exit 0.

- [ ] **Step 3: Spec checklist (do not skip)**

Confirm in the diff:

- Sidebar five items, no iOS / Help Center / Log out in snippet or recovered menu
- Configure AI → `router`
- Settings → `general`
- Docs / Feedback GitHub URLs
- Help template has no `cursor.com/help`
- About still uses existing overlay (`setOverlay("about")` / `emitOpenAbout`)
- Local chip remains

- [ ] **Step 4: Commit only if Step 3 found leftover fixes**

If no extra diff, skip. If you had to tweak copy, commit:

```bash
git add -u
git commit -m "Finish BeeBot account menu verification fixes."
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| Shared copy table + GitHub URLs | 1 |
| Sidebar packaged menu, official rows gone | 3, 4 |
| Configure AI → Router | 3, 4, 5 |
| Settings → General | 3, 5 |
| About overlay | 4 event + 5 listener + macOS About unchanged |
| Docs / Feedback URLs | 1, 2, 3, 5 |
| Recovered AccountMenu five items | 5 |
| macOS Help replacement | 2 |
| Language-aware Help rebuild | 2 (`requestApplicationMenuRebuild`) |
| `openExternal` failure notice | 3 toast, 5 `setNotice` |
| Packaging assertion | 4 |
| Create-group independent | 6 runs those tests |

**Placeholders:** none.

**Type names:** `accountMenuCopy`, `beebotDocumentationUrl`, `BEEBOT_FEEDBACK_URL`, `accountMenuActions`, `sand-open-settings`, `sand-open-about`, `registerApplicationMenuRebuild`, `requestApplicationMenuRebuild` — used consistently.
