# Botfly account menu

Date: 2026-09-14
Branch: `feature/optimization`
Status: draft for review

## Problem

The packaged app still shows the upstream Grok Bot account menu: Get Grok Bot for iOS, Help Center (`cursor.com/help`), official Send Feedback, Log out, and Cursor usage. Botfly is a local Mac agent with a Local account and no Cursor login. Those rows are the wrong product.

The same official Help Center / Send Feedback pair is in the macOS Help menu.

## Goal

Replace the account and Help surfaces with Botfly-owned items. Same five actions everywhere they appear, same destinations, copy following Settings language.

## Out of scope

- Official Grok Bot group-mode features (follow-up spec).
- Changing the About dialog body (version, icon, copy-version). About stays the existing overlay.
- Removing Router / Usage from the Settings window itself.
- iOS, Android, or Cursor sign-in.

## Surfaces

Three places must match.

### 1. Sidebar account menu (packaged original renderer)

This is the menu in the screenshot (footer under Plugins, trigger labeled Local). It is the checksum-pinned renderer plus Botfly patches, not the recovered React tree.

Items, in order:

| Item | Action |
| --- | --- |
| Settings | Open Settings on General |
| Configure AI | Open Settings on Router (Model APIs) |
| About | Open the existing About overlay |
| Documentation | Open the language-matched README in the default browser |
| Feedback | Open GitHub Issues “new issue” in the default browser |

Remove: Get Grok Bot for iOS, Help Center, official Send Feedback, Log out, Sign in, weekly usage / change limit.

The Local identity chip stays. Do not add a sign-out path for the local account.

### 2. Recovered React `AccountMenu`

`frontend/src/recovered/features/account/session/menu.tsx` and `ProductionRenderer.tsx` wiring must expose the same five items and the same actions. Keep this tree in lockstep so a future renderer swap does not bring the official menu back.

### 3. macOS application menu

- **Botfly** menu: keep `About Botfly` (existing `emitOpenAbout`).
- **Help** menu: drop Help Center (`https://cursor.com/help`) and in-app Send Feedback. Replace with Documentation and Feedback using the same URLs as the sidebar.
- Settings remains `Cmd+,` (existing shortcut). Do not duplicate Settings or Configure AI under Help.

## Copy

Follow Settings → Appearance → Language (`en` / `zh`), not the OS locale.

| Key | English | 中文 |
| --- | --- | --- |
| settings | Settings | 设置 |
| configureAi | Configure AI | 配置 AI |
| about | About | 关于 |
| documentation | Documentation | 文档 |
| feedback | Feedback | 反馈 |

Put this copy next to the existing create-bot strings in `source/shared/ui-language.ts` so the overlay snippet, recovered menu, and tests share one table.

## Destinations

| Action | Destination |
| --- | --- |
| Documentation, English | `https://github.com/yongchaoyin/botfly/blob/main/README.md` |
| Documentation, 中文 | `https://github.com/yongchaoyin/botfly/blob/main/README.zh.md` |
| Feedback | `https://github.com/yongchaoyin/botfly/issues/new` |
| Settings | Existing settings overlay, section `general` |
| Configure AI | Existing settings overlay, section `router` |
| About | Existing About overlay |

External URLs open with the desktop `openExternal` bridge. If that call rejects, show a short in-app notice (same notice path the account menu already uses for name-save errors). Do not throw out of the click handler.

## Architecture

### Original renderer (what the running app shows)

Do not edit the immutable 0.18 bundle by hand. Inject a snippet through `scripts/lib/router-renderer-patch.mjs`, same pipeline as the create-bot overlay.

Use a snippet, not a minified JSX rewrite of the upstream account menu:

- New file `scripts/lib/sand-account-menu.snippet.js`, injected from `scripts/lib/router-renderer-patch.mjs` (same `patchOriginalLanding` path as the create-bot overlay).
- On the sidebar account trigger (`.sand-agents-sidebar__account` / footer account button), prevent the upstream dropdown and render the five Botfly rows. Official rows must not remain in the DOM.
- Settings / Configure AI open the already-patched settings overlay. Configure AI lands on Router (`wDn` already includes `{id:"router",...}`).
- About uses the existing About overlay.
- Documentation / Feedback call `window.desktop` `openExternal` with the URLs above.
- Language from `window.__sandUiLanguage` / `getUiLanguage()`, same as the create overlay.

Opening Router: dispatch `sand-open-settings` with `detail.section` `"general"` or `"router"`. Extend the existing settings patch to listen and select that section after the overlay opens. If the listener cannot set React state directly, click the settings nav item for section id `router` after the overlay is visible.

### Recovered frontend

Simplify `AccountMenu` to the five items. Drop iOS gate, usage block, logout, and sign-in from the menu. Wire:

- `onOpenSettings` → `setSettingsSection("general"); setOverlay("settings")` (already close).
- `onOpenConfigureAi` → `setSettingsSection("router"); setOverlay("settings")`.
- `onOpenAbout` unchanged.
- `onOpenDocumentation` / `onOpenFeedback` → `bridge.openExternal(url)` with the language-matched URL.

`UI_TEXT` in `frontend/src/production/evidence.ts` must not keep Help Center / Log out / Send Feedback as live menu labels. Evidence anchors that document upstream strings may stay in comments, not in the rendered menu.

### macOS Help menu

Change `source/electron-main/application-menu.ts` Help submenu to Documentation + Feedback via `electron.openExternal`. Help no longer emits `open-feedback` (that overlay is the official Grok Bot form and is not used from this menu).

`installApplicationMenu` needs the UI language (or the two URLs) so Documentation picks README vs README.zh.md. Read the same stored UI language the renderer uses. If language is unavailable at menu-build time, default to English README.

Rebuild the menu when the user changes Settings language so Help labels and the README URL stay in sync.

## Error handling

- `openExternal` failure → notice string, menu closes.
- Missing settings overlay → Configure AI still attempts Settings; if Router nav is missing, leave Settings on whatever section opened (do not crash).
- Language lookup failure → English copy and English README.

## Testing

Lock behavior in `node --test`, TDD for each surface.

1. **Help template** — `buildApplicationMenuTemplate` contains Documentation and Feedback; does not contain `cursor.com/help`, `"Help Center"`, or `"Send Feedback"` as the official pair. Feedback URL is the GitHub new-issue URL. Documentation URL depends on language.
2. **Account overlay snippet** — opening the injected menu shows exactly the five labels; no iOS / Help Center / Log out. Configure AI / Settings / About / docs / feedback fire the actions above.
3. **Recovered AccountMenu** — same five items; `onOpenConfigureAi` is called for Configure AI; no logout row for a logged-in local account.
4. **Packaging** — `tests/publication-packaging.test.mjs` asserts the account-menu snippet is patched into the original renderer (same style as `__sandPickCreateGroup`).
5. **Copy** — `tests/ui-language.test.mjs` covers English and 中文 strings in the table.

## Non-goals that must not regress

- Create-group overlay fix on this branch stays independent of this spec.
- Router settings, vendor APIs, and local Docker toggle stay where they are.
- Local account still boots without Cursor login.

## Acceptance

A user on a Local account opens the sidebar account menu and sees only Settings, Configure AI, About, Documentation, Feedback. Configure AI opens Settings on Router / 模型 API. Documentation and Feedback open the GitHub URLs above. macOS Help matches. No iOS, no cursor.com, no Log out.
