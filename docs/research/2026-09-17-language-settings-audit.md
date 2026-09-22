# BeeBot 语言与设置实现事实核查（2026-09-17）

本文记录当前工作树的实现事实，作为 Web 重构设计依据，不是目标产品承诺。仅检查仓库源码、构建脚本及测试；没有读取用户私有设置、API key 或操作已安装应用。下列路径相对仓库根目录，行号以本次审计工作树为准。

## 1. 先区分实际打包入口与 React 重建源码

当前默认 build/package 使用“固定上游 renderer + 可读主进程/Host 重建 + renderer 补丁”的混合路径。不能把 `frontend/` 内的 React 组件直接当作默认发行 UI。

| 证据 | 实际含义 |
| --- | --- |
| `scripts/build.mjs:1-5` | 默认调用 `buildFidelityReconstructedAsar`，日志称使用 upstream 0.18.0 renderer |
| `scripts/package-macos.mjs:10,23` | 默认 macOS 打包也调用 fidelity 构建 |
| `scripts/clean-build.mjs:252-275` | 先准备 fidelity distribution、覆盖可读实现，再在第 273 行调用 `applyOriginalRendererRouterPatch`，最后打包 |
| `scripts/lib/router-renderer-patch.mjs:143-165` | 扫描 renderer chunks，按精确锚点修改 settings registry、settings panel、landing/create Bot 所在代码 |
| `frontend/README.md:3-6` | 声称默认 macOS 包选择 React 重建，与当前执行脚本不一致 |
| `scripts/package-macos.mjs:20-22` | 注释称原 renderer chunks byte-for-byte intact，但实际构建会打上述补丁；不能据此断言发行字节未改动 |

`frontend/src/production/ProductionRenderer.tsx` 仍是可编辑的 React/TypeScript/Vite 重建入口，可供 Web 重构复用，但它与发布补丁需要分别核查。本文不以 README 或注释覆盖可执行代码事实，也不据此声称用户电脑上某个已安装版本一定相同。

## 2. 现有语言选项、默认与存储

`source/shared/ui-language.ts:1-11` 只定义 `en | zh`，默认 `en`。没有“跟随浏览器/系统”的 auto 选项，没有独立繁体资源。`parseUiLanguage` 把 `zh`、`zh-CN`、`zh-Hans`、`zh-TW` 合并为 `zh`，其他输入回退 `en`；存储解析只接受字面 `en` 或 `zh`。

实际字段是 `SandStoredSettings.uiLanguage?: UiLanguage`（`source/shared/node/settings/sand-settings-store.ts:26-38`）；`getUiLanguage/setUiLanguage` 位于第 199-200 行。缺省值由 getter 补为 `en`，不是根据操作系统推断。

Electron 主进程在 `source/electron-main/production-binding-providers.ts:241-249` 创建 `new SandSettingsStore(join(resolveRoot(), "settings.json"))`。`source/host/host-paths.ts:9-15,59-72` 的 data root 可由 `SAND_DATA_ROOT`、用户数据目录覆盖；生产默认目录是 `~/.grokbot`，其他 variant 有不同目录。审计没有打开这些用户文件。

`sand-settings-store.ts:179-191` 使用文件替换写入 JSON；有针对无法读取配置与厂商凭据恢复的保护。它不是按登录账号保存的跨设备数据库。`scopeToAccount/clearAccountScope`（第 224-225 行）会处理部分模型、MCP、权限字段，但不会清除 `uiLanguage`。

容易误判的名称：`source/shared/host-settings.ts` 不是完整设置 schema；`source/electron-main/prefs/host-settings-fields.ts:1-3` 当前只包装 onboarding 的 Host 镜像字段。语言的权威持久层仍是上述 settings store。

## 3. 语言从 UI 到 JSON 的完整链路

### 3.1 默认发行 renderer 路径

1. `scripts/lib/router-renderer-patch.mjs:9-10,138` 在原 Appearance/Theme 区域插入 `RLanguageRow`。
2. `RLanguageRow`（第 61 行）初值 `en`，挂载时调用 `window.desktop.agent.getUiLanguage()`，将结果存入 React 局部状态和 `window.__sandUiLanguage`。
3. 选择 English/中文时，它先修改局部状态和全局变量，再 await `setUiLanguage`；catch 被吞掉；最后派发 `sand-ui-language-changed`。
4. `source/electron-preload/preload.ts:266-267` 把 get/set 映射到 main edge；set 的 payload 为 `{language}`。
5. 同文件第 331-339 行通过 `ipcRenderer`、`createMainEdgeTransport`、`bridgeRpcEdge` 建立 Electron IPC；`source/shared/rpc/main.ts:72-73` 登记对应方法。
6. `source/electron-main/main-edge.ts:120-125` 的 set 先 parse，再写 `SandSettingsStore`，调用 `requestApplicationMenuRebuild(language)`，返回 `{language}`。
7. `application-menu.ts:113-128` 使用该语言重建帮助菜单中的文档、反馈文案及文档链接；其他菜单仍有英语硬编码。

该 set handler 没有把语言同步到 Host，也没有统一的 renderer 设置变更推送。发行补丁派发的事件只在当前 window 生效。保存失败时 UI 仍可能看起来切换成功，不能把当前实现描述为可靠的跨窗口即时同步。

### 3.2 React 重建路径

1. `frontend/src/recovered/features/settings/overlay/panels.tsx:145-164` 定义 Appearance、Theme、Language 控件；语言只有 en/zh。
2. `desktop-surface.tsx:63,141-144` 维护另一份局部 language 状态，打开设置后读 bridge；读取结果为 zh 才设置 zh，未建立语言订阅。
3. 同文件第 262-266 行先 `setUiLanguage(next)`，再调用 bridge；不使用该文件已有的通用 `mutate` 错误/回滚流程。
4. `ProductionRenderer.tsx:2809-2815` 又维护根组件语言状态，只随 bridge、createBotOpen 变化读取，并非订阅设置组件的语言变更。
5. React 路径随后复用同一 preload → IPC → main edge → JSON 链路。

因此重建 UI 与发行补丁均存在局部状态与实际持久值不同步的可能；修 React 组件不自动修复默认发行补丁。

## 4. 当前本地化覆盖范围与 Bot 回复的关系

已经存在中英 copy 的具体位置：

| 位置 | 覆盖 |
| --- | --- |
| `source/shared/ui-language.ts:30-63` | 新建 Bot/群的一组标签；中文分支的 namePlaceholder 仍是 `New Bot` |
| 同文件第 67-100 行 | 中英文 README 链接、账户菜单里的设置/配置 AI/关于/文档/反馈 |
| `scripts/lib/sand-create-overlay.snippet.js:2,29,178` | 补丁创建流程和 Bot API 说明，打开时读取语言 |
| `scripts/lib/sand-account-menu.snippet.js:2,11-13` | 补丁账户菜单，打开时读取语言 |
| `scripts/lib/sand-group-ui.snippet.js:2` | 补丁群 UI 局部文案 |
| `scripts/lib/sand-vendor-accounts.snippet.js:2,74-75` | 模型厂商账户文案，并监听当前 window 的语言事件 |
| `frontend/src/recovered/features/settings/overlay/panels.tsx:511-593` | React 重建的厂商账户编辑区局部中英文文案 |

设置导航 `General/Router/Usage & Billing/Updates`、大量账户/安全/更新说明和错误仍是英语。`router-renderer-patch.mjs:64-66` 的 Router/Usage 主要也为英语。日期数字使用未明确传入 UI locale 的 `Intl.NumberFormat()`、`toLocaleString()`，不等于受 settings language 控制的格式化。

没有统一 i18n resource、全站语言 provider 或所有页面完成翻译的证据。不得把“有中文选项”写成“已完成全站国际化”。

在可读 `source/host`、`source/node-agent-coordinator` 中检索语言字段，未发现 `uiLanguage` 进入任务、系统提示或 Bot 输出选择；`SettingsService.getHostSettings/HostSettingsUpdate`（`source/host/extensions/settings/settings-service.ts:13-35`）也不包含它。现有 UI 语言不能据此理解成 Bot 回复语言，更没有 Group 工作交付语言字段。

时区不同：`main-edge.ts:99-100` 设置 override 后同步 Host；`settings-service.ts:44-45,60,76` 校验 IANA 并通知；`source/host/host-request-context.ts:5` 解析工作时区；`source/host/runner/system-prompt-assembly.ts:198` 把时区写入系统提示。语言与时区在当前实现中已经是不同影响范围。

## 5. 已有设置需要按层次理解

| 层次 | 已有字段/能力 | 实际入口或限制 |
| --- | --- | --- |
| 本机 UI 偏好 | `themePreference`、`uiLanguage` | DesktopBridge；theme 有独立通知，语言没有同等订阅 |
| Host 工作偏好 | `userTimeZone/Override`、`agentDefaultModel`、`computerUseModel` | HostSettings/SettingsService；不是纯外观 |
| 执行策略 | `autoReviewInstructions`、`localToolPermission`、`localToolPermissionCeiling` | 主进程与 Host 同步；现 UI 有 allow/block 规则及 never/ask/always |
| 模型接入 | `inferenceProvider`、`inferenceHttp`、`inferenceVendors`、`defaultInferenceVendorId` | 支持 HTTP 厂商 API 与本地 CLI 路由，密钥另存；不是账号语言 |
| 运行位置 | `boxRuntime=remote/local-docker` | 发行补丁 Router 中有本机 Docker 开关，main edge 第 231-232 行启停并重启 coordinator；不是多节点配置 |
| MCP | `mcpBoxServers`、custom instructions、disabled tools by server | store 与 HostSettings 有实际字段，不代表都放在 General 页 |
| 账户/云依赖 | Cursor account、usage/billing、feature gates | `desktop.ts:151-190` 读取；usage 还受 gate 和账户类型限制 |
| 桌面更新 | update track、idle auto-update、检查/安装 | `panels.tsx:680-769`；Electron 客户端能力 |
| 电脑管理 | SettingsComputerPanel 重建等 | Updates 页条件挂载；不能视为已经每 Bot 专属电脑 |
| 桌面特有 | WebAuthn hardware key proxy、egress through desktop | `panels.tsx:184-205,773-795`，存在平台/能力限制；不是浏览器原生通用能力 |
| 其他持久状态 | notifications、onboarding、pinnedAgentIds、sidebarSections | store 字段存在不等于有对应可编辑设置页面 |

React 设置导航位于 `frontend/src/recovered/features/settings/overlay/view.tsx:10-27`，为 General、Router、Usage & Billing、Updates；usage 条件显示。General 实际挂载账户、主题、语言、时区、本机工具权限、Auto-review、安全密钥（`desktop-surface.tsx:220-266`）。Router 挂载厂商账户和路由配置（同文件第 282 行起）。

发行补丁另向 Router 添加 Computer/local Docker 与按 provider 记录的 usage（`router-renderer-patch.mjs:60,64-66`）。因此“React Router 页有何内容”和“默认发行 Router 页有何内容”不能合并成同一事实。

未在本次读取的设置页面中发现完整的全局快捷键编辑器或浏览器通知偏好页。现有 notifications 持久字段与原生能力不得直接换名宣传为 Web 通知、Web 全局热键。

## 6. 测试证据及边界

| 测试 | 能证明 | 不能证明 |
| --- | --- | --- |
| `tests/ui-language.test.mjs:17,33` 两条 | helper 的 en/zh/default、特定 copy 与文档链接 | 设置保存、全站即时切换、跨设备、实际浏览器截图、Bot 回复语言 |
| `tests/router-renderer-patch.test.mjs:20` | registry 与 landing 在同 chunk 时补丁保留 Router | 完整 renderer 可交互或全站翻译 |
| `tests/router-settings.test.mjs:18,42,47` | provider preference round-trip、导航定义、厂商 API 编辑相关结构 | 所有外部账号、所有厂商 API 在线可用 |
| `tests/sand-settings-store.test.mjs:59,75,93` | 损坏文件保护、厂商配置保留/恢复 | 多端并发设置或用户级语言同步 |

根任务已执行 35 条相关回归并报告通过，其中包含上述两条 ui-language 测试。本审计未重复运行；该结果属于仓库回归，不是完成 Web 产品的 UI 验收。

## 7. 后续设计的事实约束

- Web 首版应复用当前 TypeScript/React/Vite 与可读服务逻辑；不新增桌面客户端。
- 语言选项、locale resource、跨设备个人偏好、Bot 回复语言、群交付语言均需明确新契约，不能声称当前已有。
- 现有 UI 语言迁移只迁移个人偏好，不能把它写入 Bot 身份或重写历史消息。
- 模型/MCP/安全/电脑字段应按权威层迁移；不要复制一份旧 settings.json 作为新 Web 全局万能设置。
- 云账号、桌面更新、硬件安全密钥代理、桌面 egress 与浏览器限制必须分别处理，不能用无实现的设置开关占位。
