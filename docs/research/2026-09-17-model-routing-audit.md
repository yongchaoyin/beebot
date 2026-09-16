# BeeBot 厂商配置与模型路由源码审计

日期：2026-09-17。范围：当前工作树源码、构建脚本和现存 macOS 包；只读审计，未启动 App、未调用真实模型、未重建或运行测试。本文记录现状，不以目标设计文档证明已有能力。

## 1. 实际构建与界面入口

`npm run build` → `scripts/build.mjs:1` → `buildFidelityReconstructedAsar()`。`scripts/package-macos.mjs:23` 使用同一构建；`scripts/clean-build.mjs:270` 激活源码 Host/Electron main，`:273` 向上游 renderer 注入 Router 设置 UI。

Host 并非因为没有外部 manifest 就必然使用旧 artifact。`scripts/host-production-activation.mjs:575` 调用 `assembleHostProductionBindingManifest(manifestPath)`，后者可自动组装绑定；检查通过才打包源码 Host。

发布路径的模型表单是 `scripts/lib/sand-vendor-accounts.snippet.js:63` 的 `RVendorAccounts`，由 `scripts/lib/router-renderer-patch.mjs:64` 的 `RRouterPanel` 渲染。`frontend/src` 下的设置 TSX 属于另一条 clean-source renderer 路径，不能单凭其代码推断默认包行为。

已直接读取 `dist/BeeBot.app/Contents/Resources/app.asar`，未解包写盘：

| 现存产物 | 本次核对结果 |
| --- | --- |
| 内嵌 `dist/reconstruction-build.json` | Host、Electron main、node-agent-coordinator 均为 clean-source；renderer 为 checksum-pinned-artifact-runtime |
| `dist/host/host-main.cjs` | 包含 `resolveInferenceForAgent`、compatible chat 实现、Codex direct endpoint |
| `dist/node-agent-coordinator/main.cjs` | 包含 `createCoordinatorInferenceRouter`、Codex direct endpoint；未包含每 Bot resolver |
| `dist/electron-main/main.cjs` | 包含 `upsertInferenceVendor` |
| `.build/fidelity/app/dist/renderer-router-extension.json` 与对应 renderer chunk | 记录并含有 `RVendorAccounts` / `RRouterPanel` 注入 |

以上 ASAR 修改时间为 **2026-09-15 22:23:35 +08:00**，构建记录为同日 22:23:32。它证明这些路径曾进入本地包，不能证明当前工作树重新构建成功、当前正在运行的 App 就是该包，或真实模型请求已通过。

## 2. 配置概念与保存链

`source/shared/inference-vendor.ts:1` 的 HTTP provider 仅四种：`openrouter`、`openai`、`deepseek`、`custom`。`:31` 的 `InferenceVendorAccount` 字段为：

```ts
{ id, label, provider, baseUrl, modelId, secretKey }
```

这里一条 account 同时表示厂商连接与一个模型；没有独立 wire protocol、多个模型目录、能力声明、验证结果或配置 revision。预设 URL/模型在 `:20`，属于代码内静态默认值，不能当作今天可用模型的证明。

实际 UI → 存储链：

1. `sand-vendor-accounts.snippet.js:98` 展示名称、厂商、API key、Base URL、Model ID 五项；`:87` 调 `window.desktop.agent.upsertInferenceVendor()`。
2. `source/electron-main/main-edge.ts:132` 补预设、trim 字段、校验 URL/Model ID 非空及已有/新 key 是否存在。没有发送网络请求验证鉴权、协议、模型或工具能力。
3. `:153` 将 key 写入 settings 同目录 `box-secrets.json`；`:160` 保存厂商数组，`:161` 处理默认项；`:162` 同时改全局 `inferenceProvider` 和 `inferenceHttp`。
4. `:164` 起同时激活 local account、完成 onboarding、将本地工具权限设为 always、关闭 auto review、选择 local-docker。这是现有耦合副作用，不是单纯保存模型资料。
5. `:170` 异步 `syncHostSettingsToBox()`，失败被 `.catch(() => null)` 吞掉；保存返回不代表执行端已确认应用。

编辑 key 留空时保留旧 key。删除 `main-edge.ts:179` 仅过滤数组，没有检查 Bot 引用、撤销正在执行的请求、清除 key 或同步应用确认。

## 3. 配置与凭据存储

- Electron settings：`source/electron-main/production-binding-providers.ts:249` 创建 `SandSettingsStore(getSandRootDir()/settings.json)`。
- root 解析：`source/host/host-paths.ts:66`，优先 `SAND_DATA_ROOT`，其次指定 user-data-dir 的 sand-data；production 常规目录为 `~/.grokbot`。
- settings 字段：`source/shared/node/settings/sand-settings-store.ts:34` 的 `inferenceProvider`、`inferenceHttp`、`inferenceVendors`、`defaultInferenceVendorId`、`inferenceRouterUsage`。
- key：`source/shared/node/vendor-secrets.ts:16` 原子替换 `{version:1,secrets:{...}}`，文件 mode=0600；此函数没有加密。
- `source/electron-main/box/local-docker-host-connector.ts:199`、`:200` 把 settings/key 文件 bind mount 到共享 Host 的 `/home/box/sand-data`；`:198` 为全局 workspace/data 卷，并非每 Bot 独立凭据卷。
- 同 connector `:157` 还把宿主 `.codex`、`.claude` 整目录只读挂入 `/root`。这不能视为每 Bot 已有独立登录隔离。

`SandSettingsStore.getInferenceVendors()`（`:262`）对旧 HTTP 配置合成 id=legacy。`:150` 在厂商列表为空时可从遗留 secrets 恢复列表；恢复逻辑会按 key 值或现存厂商 key 猜 provider。删除最后一条配置后仍留 secrets，因此可能触发恢复；这是代码推断，未做运行复现。

## 4. 每 Bot 绑定与 Host 模型回合

`source/host/agents/agent-profile.ts:12` 在 `profile.json` 保存 `inferenceVendorId`；文件位于该 agent 目录。`source/host/extensions/session/agent-session.ts:97` 修改 profile，保留未指定字段；`session-materialization.ts:77` 创建时写入绑定，clone 也复制该字段。

Host 的主路由：

```text
Host/Runner 创建本次 turn
  -> turn-run-shell.ts:182 resolveInferenceForAgent(conversationId)
  -> profile.inferenceVendorId 非空：精确找该 account，缺失则抛错
  -> 未绑定：getInferenceVendor(undefined)，取有效默认或第一条
  -> 没有 account：才使用全局 inferenceProvider
  -> cursor：已有 Cursor inference session
  -> 其他：createProviderPromptSession(provider, vendor)
  -> ProviderPromptExecutor.stream -> 对应 provider executor
```

resolver 位于 `source/host/extensions/inference/resolve-inference.ts:36`，兼容 `${root}/agents/{id}/profile.json` 和 `${root}/{id}/profile.json`。`MissingInferenceVendorError` 是明确失败，不静默换 Cursor。

`turn-run-shell.ts:187` 的非 Cursor summarization 也用同一厂商 account。`inference-service.ts:53` 与 `cursor-session.ts:110` 另有 resolver 入口。现状没有统一不可变 ModelBindingSnapshot；厂商信息在创建 session 时读取，HTTP key 在执行时再次取环境/文件，不存在完整的在途版本契约。

### HTTP 实际实现

`source/host/extensions/inference/provider-session.ts:263` 对全部四类使用：

```ts
createOpenAI({ apiKey, baseURL, compatibility: "compatible", name: provider }).chat(modelId)
```

即 OpenAI-compatible Chat Completions 路线；不是自动协议识别，也没有由 custom 推导 Responses/Anthropic 原生支持。SDK 依赖为 `@ai-sdk/openai ^1.3.24`、`ai 4.3.17`（package.json）。

- `httpVendorSession()`（`:50`）优先账户环境变量 key，其次账户持久化 key，再次厂商预设 key；因此凭据存在跨账户 fallback。
- OpenRouter 可被 `SAND_OPENROUTER_MODEL` 覆盖（`:58`），不一定按 UI 的 modelId 发出请求。
- HTTP 传入 CoreMessage 及转换后的 tools，使用流式执行、180 秒 timeout；没有模型能力目录证明所有模型都支持图片/tool calling。
- `source/shared/http-tool-parameters.ts:30` 会在只有文本且未调用工具时合成 `SendMessage`。这证明文本可进入现有 transcript，不证明模型真的调用过工具。
- `getAvailableModels`（`main-production-services.ts:721` → `models/cursor-model-catalog.ts:12`）调用 Cursor AiService，不是自定义 HTTP 厂商的 `/models` 发现接口。

## 5. Coordinator 全局例外与 CLI 名称的真实含义

`source/node-agent-coordinator/main.ts:214` 创建 router，`:228` 在 gateway dispatch 之前尝试处理请求。它由 Electron coordinator launcher fork 到桌面侧 utility process（`source/electron-main/coordinator/coordinator-launcher.ts:49`），不是 Bot 的独立容器进程。

`source/node-agent-coordinator/inference-router.ts:213` 只截获全局 provider 为 codex/claude-code 的 `sendPrompt`；HTTP 和 Cursor 继续走 Host。它读取全局 settings，不读取每 Bot `inferenceVendorId`。

所以同一个 Bot 可能出现：私聊被全局 CLI router 接管，而经 Host 执行的群/其他回合遵循 profile 或默认 HTTP account。这是当前路由条件推导，未进行真实私聊/群对照运行。

Coordinator 的上下文和输出也不同：

- `:59` 使用 `${dataDir}/inference-router-transcript.json`，schemaVersion=2，按 agent 分组只保留最近 200 条 user/assistant 文本记录。
- `:153` 发模型的 messages 来自这个本地列表；前面读取的远端 transcript 用于计算 turn 编号，没有拼成完整 Host 模型历史。
- `:159` 起 Claude 使用 MCP HTTP bridge，其他 provider 直接 tool callback；生产接线 `coordinator/production-provider.ts:424` 使用桌面 MCP registry，不应等同 Host 完整电脑工具集合。
- `:217` 执行失败写 `Router error: ...` assistant 消息；上游先得到 accepted，队列和活动提示在进程内。

| 名称 | 当前实际执行 | 关键限制 |
| --- | --- | --- |
| codex | `provider-session.ts:83` 读取私有 `.codex/auth.json`；`:196` 直接请求 `https://chatgpt.com/backend-api/codex/responses`，自行 refresh token | CLI binary 不在请求路径；不是 OpenAI Platform API，也不是已实现的官方 Codex CLI adapter |
| claude-code | `provider-session.ts:219` 查 executable，用 `@anthropic-ai/claude-agent-sdk.query`，cwd=getSandRootDir() | 环境决定身份；persistSession=false；有 MCP bridge 时最多 8 turns，否则 tools=[]/1 turn |
| cursor | Cursor backend/session、account token、模型实验/默认模型配置 | 不能当成无需原后端的通用公开厂商接入 |

Codex 模型取 `SAND_CODEX_MODEL` → `.codex/config.toml` → 代码默认 `gpt-5.4`；effort 同样取环境或 config。Claude 模型取 `SAND_CLAUDE_MODEL`，无统一 account 内 modelId。`source/shared/node/inference-router-local.ts:51` 的 Codex installed 状态甚至按 auth 文件存在计算，并注释说明不调用 CLI。

Host provider 接口与 coordinator executor 的工具执行契约也不等价：`provider-session.ts:293` 给 Codex definitions 但 executeTool=undefined；`codex-direct-responses.ts:162` 遇 tool call 会抛未提供 executor。Host Claude 调用不带 MCP bridge（`:294`）。这两处不能据“有 provider 名称”就宣称已完整支持 Host 电脑/群工具；需补独立真实回合验证。

## 6. 现有测试证明到哪里

| 测试 | 已有断言范围 | 不能据此证明 |
| --- | --- | --- |
| `tests/inference-vendor.test.mjs:18` | parser、去重、预设、必填、trim；部分 UI/路由源码正则 | 网络鉴权、真实模型能力、发布 UI 交互 |
| `tests/resolve-inference.test.mjs:36` | 实际执行 resolver，精确 Bot account 优先、已删除引用报错 | coordinator 与 Host 一致、在途修改 |
| `tests/inference-router-transcript.test.mjs:27` | richText/mention 序列化及畸形字段拒绝 | 完整 Host memory、CLI 生命周期或工具执行 |
| `tests/codex-direct-responses.test.mjs:27` | mock fetch 的 SSE、工具 call id 往返、截断流失败 | 当前官方服务可用性、订阅授权、真实取消 |
| `tests/inference-tool-struct.test.mjs:30` | tools 参数结构编码 | 每个模型都理解/支持该工具格式 |
| `tests/publication-packaging.test.mjs:125` | 源码接线/patch 内容正则；明确包含 direct Codex | 真实厂商端到端测试 |

本轮未运行这些测试。没有从本轮证据得出模型账户可用、key 有效、全部模型支持视觉/工具、现有 CLI 与 HTTP 可等价迁移等结论。

## 7. 后续设计必须承接的事实

现有模型管理已包含多 account、按 Bot 选 account、同厂商不同 URL/key/model、默认 account、HTTP 工具适配及两种本地 provider 路线。后续应保留这些可见能力并统一入口；不能将已有 Codex direct 描述为 CLI，不能把四个 preset 扩称支持所有协议，也不能迁移时悄悄放弃 CLI/历史或继续保留私聊/群模型不一致。
