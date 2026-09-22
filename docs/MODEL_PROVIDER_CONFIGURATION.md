# BeeBot 模型厂商配置与运行规格

版本：1.0 · 2026-09-17 · 状态：待开发的目标规格。

本文补充 [主规格](./BEEBOT_SWARM_DESIGN_AND_DEVELOPMENT.md) 第 4、8.7、9 节，依据 [当前模型路由审计](./research/2026-09-17-model-routing-audit.md) 制定。现有代码能力、首版需要实现的能力及验证门槛分别标注。Service 不运行 Bot 模型回合；BotRuntime 保管私有模型历史、调用模型并执行工具；NodeAgent 只转发与管理环境。

## 1. 已选定的首版范围

首版优先复用现有 HTTP Chat Completions 适配和多 account UI 语义。保留 **OpenAI、OpenRouter、DeepSeek、Custom 四类入口**，其中前三个是预设、Custom 是手工连接。协议显式固定为 `openai-chat-completions`；不通过厂商名称推导 Responses、Anthropic Messages 或所有模型能力。选模型始终允许手填精确 Model ID，不强依赖联网目录。

HTTP 接入、Codex、Claude Code 最终统一为每 Bot 的 ProviderAdapter，由所属 BotRuntime 调用。私聊、群、Routine、摘要、子任务不得再绕过每 Bot 绑定改走桌面全局 router。移除旧 coordinator 模型回合前，必须完成相应身份、配置、历史与工具桥的迁移验收。

| 接入 | 当前源码事实 | 第一完整版本决定 |
| --- | --- | --- |
| OpenAI / OpenRouter / DeepSeek | 全部使用 `createOpenAI(...).chat(modelId)` | 正式 HTTP 入口；每个实际 modelId 需通过所需能力验证 |
| Custom | 手工 baseUrl/modelId/key，同一 chat adapter | 正式兼容入口；只保证已验证的 Chat Completions 子集，不宣传通吃所有网关 |
| Codex 当前 direct | 读取 Codex auth 文件，自行请求专用 backend；不是 CLI 执行 | 保留为清楚标注的 `codex-direct-legacy` 迁移兼容方式，不能冒称公开稳定协议；先移入专属 Runtime、补工具与停止契约，验收未过则明确显示迁移阻塞 |
| Codex 目标 adapter | 尚未实现官方 CLI/SDK adapter | 选定 `codex-cli` 为新建连接的方向，使用官方支持的本地 CLI/SDK；身份、MCP、模型选择、停止及双架构须验证后启用 |
| Claude Code | 已有 Agent SDK + executable 路线，桌面 coordinator 与 Host 接线不同 | 保留 `claude-agent-sdk`；在 Runtime 内统一工具桥、版本和凭据。新建连接默认 API key，不复制宿主登录目录 |
| Cursor backend | 有原账户、后端和模型目录依赖 | 导入时保留配置和历史，标为 `cursor-legacy`；不能在没有原依赖时伪装为已支持。由用户选择保留旧环境或显式迁移 |
| 原生 Responses / Anthropic Messages / Gemini 等 | 本次审计未发现对应完整通用配置入口 | 不纳入首版新 HTTP 协议选择器；需另建 adapter/测试后开放，不能由 Custom 自动承诺 |

CLI 分支的源码存在不等于已通过新架构验收。第一完整版本必须通过 HTTP、`codex-cli` 与 `claude-agent-sdk` 的对应门槛；开发中可以明确显示尚待验证，但不能靠把全部 CLI 标为不可用就宣布完整版本完成。旧 direct/Cursor 只要求无损导入和明确迁移入口，不承诺其私有服务持续可用。发布清单逐项写“正式支持 / 迁移兼容 / 尚待验证”，不能自动改成另一厂商或无提示删除功能。

## 2. 概念与最小数据模型

| 概念 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| ProviderConfig（厂商实例） | 一组 endpoint、协议、认证与使用范围；同厂商可建多个实例 | 不是模型身份，也不是 Bot 身份 |
| Adapter / protocol | 实际请求、流解析、工具与取消规则 | 不根据 logo 自动拥有全部能力 |
| ProviderModel（模型项） | 实例内精确 modelId、显示名、能力与测试证据 | 不把目录中出现当作可调用证明 |
| BotModelBinding | Bot 固定的 providerId + providerModelId + 明确参数 | 不在每回合临时追随 workspace 默认 |
| ModelBindingSnapshot | attempt 开始时的不可变配置版本 | 不保存 key 正文或完整私有历史 |
| ProviderTest | 某配置、模型、Runtime、adapter 版本的一次验证结果 | 不授予真实业务工具权限 |

首版数据库保留独立的 ProviderModel 行，但 UI 不做复杂采购目录：新建厂商时同时添加一个手填模型，可在详情页再添加模型。每个 Bot 选“厂商实例 + 模型”。同实例多模型共用被授权的连接凭据，不必为每个模型复制 key。旧 account 一对一导入实例和模型，**不按相同 URL、名称或 key 自动合并**。

```ts
type ProviderAdapter =
  | "openai-chat-completions"
  | "codex-cli" | "claude-agent-sdk"
  | "codex-direct-legacy" | "cursor-legacy";

interface ProviderConfig {
  id: string; workspaceId: string; label: string;
  preset: "openai" | "openrouter" | "deepseek" | "custom" | "codex" | "claude" | "cursor";
  adapter: ProviderAdapter;
  baseUrl?: string; // HTTP API 根路径；CLI 不从这里猜协议。
  authMode: "api-key" | "none" | "runtime-login";
  secretRef?: string; secretVersion?: number;
  revision: number; status: "active" | "disabled" | "migration_required";
  authorizedBotIds: string[]; // 不自动授权同群所有 Bot。
  networkPolicyId?: string;
}
interface ProviderModel {
  id: string; providerId: string; modelId: string; label: string;
  revision: number; source: "manual" | "discovered" | "legacy";
  availability: "unknown" | "available" | "unavailable";
  capabilities: Record<string, "unknown" | "supported" | "unsupported">;
  capabilityEvidenceIds: string[];
  contextLimit?: number; maxOutputLimit?: number;
  supportedParameters: string[];
}
interface BotModelBinding {
  botId: string; providerId: string; providerModelId: string;
  revision: number;
  parameters: { maxOutputTokens?: number; temperature?: number; reasoningEffort?: string };
}
```

ProviderConfig.id 是实例主键；模型唯一约束为 `(providerId, modelId)`，每 Bot 只有一条主绑定。所有引用验证同 workspace；ProviderModel 和绑定可经所属 provider/Bot 关联 workspace，不允许仅查行 ID 后跳过授权。`providerModelId` 指 ProviderModel.id，`modelId` 才是发给厂商的精确字符串，二者不得混用。modelId 区分大小写，trim 首尾空白后保留 `/`、`:`、日期等字符，不从显示名推导。CLI 的 modelId 也需明确，不能悄悄使用宿主环境默认值。

owner 创建 Bot 或修改其模型绑定时，选择厂商即明确授权该 Bot 使用此接入，页面说明这一效果；绑定与 authorizedBotIds 授权记录在同一公共事务提交。新接入默认无 Bot 授权，配置为“新 Bot 默认”只预填表单，不提前授权未来身份。模型/群成员不能自行扩充授权；撤销授权必须使对应未完成执行按停止/unknown 规则收束。

公共配置、绑定、测试摘要、版本、secretRef 在 control.db。密钥密文放独立 secret store，主密钥不写 control.db/普通备份；Bot 私有 memory/model history 仍只在 Runtime 私有存储。测试仅记录必要请求元数据、脱敏错误、费用/usage、能力结论，不记录任何 Bot 私有上下文。

## 3. Web 配置流程与字段

入口为“设置 → 模型服务”，列表展示名称、接入方式、可用模型数、凭据状态、最近验证状态与引用 Bot 数。删除、停用、替换 key 分开，避免把删除配置伪装为上游已撤销凭据。

HTTP 新建表单按顺序展示：

1. 连接名称：必填，1–80 字符，仅展示；允许同厂商多实例。
2. 厂商预设：OpenAI、OpenRouter、DeepSeek、Custom。切换预设只在新表单填默认值；编辑已保存连接不得静默重写 URL 或模型。
3. 协议：显示“OpenAI Chat Completions”，首版不可改为未实现协议；更改 adapter 需创建新实例并显式迁移绑定。
4. Base URL：填写 API 根路径，预设分别为 `https://api.openai.com/v1`、`https://openrouter.ai/api/v1`、`https://api.deepseek.com`。adapter 只追加 `/chat/completions` 或 `/models`，不擅自插入/删除 `/v1`；URL 预览展示最终路径。
5. 认证：默认 Bearer API key。Custom 可显式选“无需认证”，适用于已授权本地服务；空 key 不隐含无认证。
6. API key：密码输入；创建必填或显式无认证。编辑用 keep/replace/clear 三态，未修改不回传旧 key；任何 GET 不返回明文。clear 会禁用依赖该凭据的新调用，并按撤销策略处理既有 attempt，不能让已清除 key 的配置继续显示 ready。
7. 模型：手填 modelId 和可选显示名；有目录时提供辅助搜索，不替用户选中第一个模型。旧预设 modelId 仅为迁移值，不作为新建的过时强制默认。
8. “保存连接”“检查连接”“在 Bot 上验证”三个动作分开；保存成功显示“已保存，尚未验证”，不能显示“已连接”。

URL 校验使用 URL parser：拒绝 username/password、fragment、query、非 http(s)、控制字符、完整 `/chat/completions` 等调用路径。去除末尾斜杠；公网默认要求 HTTPS。不跟随把 Authorization 发往另一 origin 的重定向。

Custom 的内网 HTTP 地址需 owner 为该实例显式选择网络范围，并指定可访问的执行节点；不能让任意 URL 探测 Service/Node 管理面、云元数据或其他 Bot 管理端点。Service 无法访问节点内网服务时允许跳过 Service 探测，等待目标 Runtime 验证，不因此判定配置错误。界面解释 `localhost` 指实际发请求的 Runtime 环境；不能把浏览器电脑地址当作执行端地址。

首版不开放任意 header、任意请求 JSON、任意命令/环境变量编辑。OpenRouter 标识 header 等由 adapter 明确处理。特殊网关需自定义 header 时，单独定义 allowlist 和 secret header 存储后再扩展。

## 4. 模型目录、能力和参数

手填是必需路径；发现是可失败的增强。`GET /providers/{id}/models` 读取已保存目录；`POST /providers/{id}/model-discoveries` 才发起刷新。预设可 GET `/models`，Custom 默认手工，可显式启用 compatible `/models`；不复用当前 Cursor `getAvailableModels`。

发现失败保留旧目录和所有手工模型；返回 failure/stale 时间，不用空数组覆盖。发现不存在某手工 ID 不自动删除或撤销 Bot 绑定。目录是否有模型、账户是否可调用、adapter 是否支持该功能是三个状态。

至少独立表示 `textOutput`、`streaming`、`functionCalling`、`imageInput`、`structuredOutput`。厂商 metadata 作为 declared evidence，Runtime 测试作为 verified evidence，两者不混用。参数不支持时明确拒绝，不静默丢弃；未知能力不作 supported。

首版 Bot 模式按验证结果开放：

- 基础对话至少验证 textOutput；streaming 未支持时可显式采用完整响应，UI 展示模式。
- 群工作/电脑工具必须验证 functionCalling，包括一次工具结果回送后的正确接续。
- 需要截图理解的图形电脑任务还必须验证 imageInput。没有视觉能力时仍可保留文本工作和已验证的文本工具，不谎称模型能看屏幕。
- 结构化输出不是普通工具调用的同义词；首版不把严格 JSON 输出作为所有 Bot 的必需条件。

`temperature`、`reasoningEffort` 只在所选模型/adapter 的已知允许范围展示，默认省略；不默认给所有模型发 temperature=1。maxOutputTokens 需有 adapter 参数映射，并被模型限制与工作预算共同约束。无法确认上下文窗口时使用显式保守配置并显示“未验证”，不得伪造厂商上限。

官方 OpenAI Chat Completions 文档明确参数和模态取决于模型；OpenRouter 目录提供模态与 supported_parameters。二者都不替代本项目工具与输入转换的端到端测试。见 [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[OpenRouter 模型目录](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)。

## 5. 首次配置与 Bootstrap 闭环

不能要求“先有可运行 Bot 才能测试 key”，又要求“key 测试成功才能创建 Bot”。选定以下流程：

1. 用户初始化 workspace，保存 ProviderConfig 与至少一个模型；Service 做本地字段校验。
2. 可选 `mode=connectivity`：Service 只执行无 Bot 上下文的有限认证/模型目录探测。没有 `/models`、Service 不能访问内网或目录权限不足，结果是 inconclusive/unsupported；不能据此宣布推理一定失败。此模式不发生成请求。
3. 允许创建 `configuration_pending` Bot 草稿和专属 Runtime/电脑；资源准备不依赖模型已验证，也不提前调用模型。选择节点、应用身份配置、安装必要 adapter。
4. 用户点击“在该 Bot 上验证”，Runtime 对选定配置做真实推理与所需能力探测；`purpose=provider_test` 的 RunAttempt 可无 GroupRun，但有 Bot 锁、租约、独立测试预算和 outbox。测试不加入群、不写长期记忆、不执行真实外部业务工具。
5. 通过该 Bot 模式所需测试后变为 ready；失败保留草稿、电脑和已填配置，提示可修复字段。验证期间消息可由 Service 接受并排队，不能临时由 Service 代跑回复。

Bot.configurationStatus使用configuration_pending/ready，测试失败保留pending及原因；Runtime的启动/在线状态是另一份资源状态。`provider_test`只要求资源、adapter、身份与授权已就绪，允许对未知模型能力进行限定探测；普通DM/群/Routine必须通过模型所需能力门槛。不能给所有attempt同用一个ready布尔而再次堵住首次验证。

测试采用固定无隐私内容：短文本、随机 nonce 的本地 echo 工具往返、明确需要视觉时的内置测试图。不得使用用户历史、文件或实际邮箱等工具。默认总截止 120 秒、最多 4 次模型请求、每次至多 512 输出 token；实际 adapter 不支持该预算参数时先明确能力限制。测试可能产生厂商费用，按钮直接展示此事实，用户点击即授权这次限定测试。

真实测试结果绑定 `(providerId, providerRevision, secretVersion, modelId, modelRevision, runtimeId, adapterVersion, configRevision)`。换 endpoint、key、模型、adapter 版本或运行节点后，旧报告保留为历史，不可直接将新环境标为已验证。无需每回合重复测试；新 attempt 按当前验证与能力快照检查。

## 6. 每 Bot 绑定、默认值与修改生效

Workspace 默认值是“新 Bot 的预填选择”，保存后新 Bot 持久绑定具体实例和模型；已有 Bot 不追随默认变化。同群可以使用不同厂商/模型，长期身份和记忆不因换模型清空。

首版一个 Bot 一个主模型，摘要默认同一绑定；不引入隐形低价模型或自动 fallback。辅助模型分工后续需作为显式独立绑定设计。`SAND_OPENROUTER_MODEL`、`SAND_CODEX_MODEL` 等旧环境覆盖只在导入报告里显示，导入新系统后转换为明确绑定，不能继续暗中覆盖 Web 配置。

每次 attempt 调度前固定 `ModelBindingSnapshot`：bindingRevision、providerRevision、modelRevision、modelId、adapterVersion、parameters、secretVersion、能力证据 ID。公开 Attempt 只存引用与摘要，Runtime 接收对应可验证配置及受限凭据。

普通编辑默认 `effective=next_attempt`：正在执行者保持已授权快照，新尝试使用新绑定；不在一条模型流或工具回送途中换模型。Runtime ACK 应用后方可派发要求该版本的新尝试。排队但未开始的旧配置 attempt 取消并重新预留，保留因果记录，不悄悄原地改 snapshot。

停用/撤销是另一条操作：立即禁止新请求，通知停止受影响 attempt，按租约与 unknown 规则收束。已发出的外部请求和费用不能撤销；已提交成果保留。仅轮换 key 可保留旧版本给既有 attempt 直到结束/短期到期；选择“立即撤销旧 key”则必须中止旧 attempt，不能一边撤销一边承诺它完成。

## 7. HTTP 与 CLI 的执行和凭据边界

authMode=api-key 只描述认证材料；HTTP chat adapter 使用 Bearer header，Claude SDK 按其官方 API key 接口接收材料，不能把所有 adapter 都编码为 Bearer 协议。HTTP 真实请求在所属 BotRuntime 的受信 ProviderAdapter 发起，NodeAgent 不装配上下文。Service secret store 可以保存 owner 授权的共享 API key；只向授权 Bot 的 Runtime 交付使用材料，或使用仅转发的凭据 broker。不能因同群自动共用 key；网页只见 secretConfigured、状态和版本。

CLI/SDK binary、工作目录、配置、会话、登录全部属于该 BotRuntime。模型可控工作进程不能读写受信 adapter 身份、key 和监管回执；同一 Bot 专属环境内按主规格的保护域规则隔离。禁止复制宿主整份 `.codex`/`.claude` 或由 Service 执行 CLI。

Codex 明确选择官方本地 CLI/SDK adapter 作为新路径，固定 binary/SDK 版本和模型参数；官方提供 SDK 和 API key/交互登录方式，但本项目的工具桥、取消和双架构仍需实测。默认自动化连接用 API key；若提供官方交互登录，授权发生在该 Bot 的专属环境，不能让 BeeBot 自行解析账号 token 冒充已完成新 adapter。参考 [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)、[Codex authentication](https://learn.chatgpt.com/docs/auth)。

现有 `codex-direct-legacy` 必须单独标识；不把它包装成 `codex-cli`。如保留兼容运行，凭据、手写 refresh 和私有 endpoint 仍是该 adapter 的维护风险，真实可用性是独立发布门槛。迁移不能把旧文本 JSON 历史当作官方 CLI 原生 session；由 Runtime 构造带来源的会话摘要/显式输入，保留原记录，不伪造 resume ID。

Claude 保留 Agent SDK 方式，选择 API key 为新建默认，固定 SDK/executable 版本。已有用户登录不是自动变成可共享订阅凭据；登录方式必须由当前官方支持范围及部署性质确认，不能仅凭存在 `.credentials.json` 就显示已认证。官方 Agent SDK quickstart 提供 API key 路线，并对产品提供订阅登录另有条件，见 [Claude Agent SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)。

CLI adapter 的必过门槛：只暴露当前 attempt 授权工具；每次工具 call 都经过 BeeBot 的 fencing、资源与权限判断；能停止真实子进程及后台任务；CLI 自带 Shell/浏览器不能旁路监督；私聊和群使用同一绑定/历史边界。不能用一段 prompt 声明代替这些约束。外部 SDK 再有子循环，也由 BeeBot Runner 作为外层生命周期和预算权威。

## 8. API、事务与 DTO

统一前缀 `/api/v1/workspaces/{w}`，修改仅 owner；使用主规格的鉴权、CSRF、Idempotency-Key、expectedRevision、事件和 outbox。Bot 只能读取已授权能力描述，不能修改连接。

| 方法与路径 | 契约 |
| --- | --- |
| GET/POST `/providers` | 列表/新增连接，可原子带 initialModel；返回脱敏配置，不返回 key |
| GET/PATCH `/providers/{id}` | 读/改 label、endpoint、secret 操作等；协议不原地改；返回 revision 与受影响 Bot |
| POST `/providers/{id}/disable` | 立即禁止新请求并停止该实例全部活动 attempt；首版固定 stopActive=true，不提供静默继续选项，产生取消/unknown 事件 |
| DELETE `/providers/{id}` | 被绑定或 active/unknown attempt 引用则 PROVIDER_IN_USE；无引用后软删并保留审计 |
| GET/POST `/providers/{id}/models` | 读已保存目录/新增手填模型 |
| PATCH/DELETE `/providers/{id}/models/{providerModelId}` | 修改显示/声明或删除无引用模型；modelId 改动视为新增模型 |
| POST `/providers/{id}/model-discoveries` | 可选目录刷新；返回 jobId，不删除手工项 |
| POST `/providers/{id}/test` | mode=connectivity 或 inference；后者必需 targetRuntimeId、providerModelId、testCapabilities，且 Runtime 所属 Bot 已获该接入授权 |
| GET `/provider-tests/{testId}` | status、executedBy、版本、各能力结果、脱敏错误、usage |
| GET/PATCH `/settings/model-defaults` | 默认 providerId/providerModelId；只影响后续 Bot 创建 |
| GET/PATCH `/bots/{botId}/model-binding` | 精确绑定；expectedRevision、effective=next_attempt；返回 pending/applied 版本 |
| POST `/bots/{botId}/provider-login-sessions` | 仅已开放的 Runtime login adapter；返回短期交互会话，不返回登录 token |

创建示例，`apiKey` 仅请求写入，不出现在响应：

```json
{
  "label": "团队 OpenAI",
  "preset": "openai",
  "adapter": "openai-chat-completions",
  "baseUrl": "https://api.openai.com/v1",
  "auth": { "mode": "api-key", "operation": "replace", "apiKey": "<write-only>" },
  "initialModel": { "modelId": "<用户有权限使用的精确ID>", "label": "主模型" }
}
```

secret store 与 control.db 不能假装一个跨库事务：先写不可变密文版本 pending，再在公共事务写 config/secretRef/event/outbox；失败清理无引用 pending。旧版本仅在所有引用结束或明确撤销后回收。相同 Idempotency-Key 返回首次接受结果；不得重复轮换 key 或为同一测试创建第二个执行。外部请求已发出但确认丢失时保留 inconclusive/可能计费，不保证上游恰好一次；重启不能自动重发该不确定测试，用户显式发起新测试才创建新 testId。

ProviderTest 状态为 queued/running/passed/failed/inconclusive/cancelled；状态 passed 仅指请求的能力集合全部通过。返回 `executedBy=service-probe|bot-runtime`，不能把 Service probe 显示成 Runtime ready。测试调度与真实任务共用 Bot 互斥和租约规则，测试取消确认前不得释放占用。

错误至少包含 `PROVIDER_AUTH_FAILED`、`PROVIDER_ENDPOINT_UNREACHABLE`、`PROVIDER_PROTOCOL_MISMATCH`、`MODEL_NOT_FOUND_OR_FORBIDDEN`、`MODEL_CAPABILITY_UNVERIFIED`、`MODEL_CAPABILITY_UNSUPPORTED`、`PROVIDER_RATE_LIMITED`、`PROVIDER_QUOTA_EXCEEDED`、`PROVIDER_IN_USE`、`PROVIDER_CONFIG_STALE`、`RUNTIME_NOT_READY`、`PROVIDER_MIGRATION_REQUIRED`。无法从上游响应区分 404 与账户无权时保留联合错误，不猜测原因。未知 raw error 脱敏后关联 requestId，不含 Authorization、cookies 或完整响应历史。

429/5xx 只做有界、可取消退避，并计入 attempt 预算；401/403、错误 modelId、协议错误不自动重试或换 key。已经发出的不确定请求不得声称“未花费”，工具副作用按主规格 unknown 核对。

## 9. 迁移与开发顺序

1. 先保留当前 resolver/HTTP tool adapter 的有效行为，建立统一每 Bot `resolveModelBinding()` 契约及 snapshot；删除 key/模型 fallback 需通过显式迁移转换，不能直接改变运行账号。
2. 迁移 `settings.json` 的 accounts、默认项和 profile.inferenceVendorId；旧“未绑定”Bot 先解析当时默认并在导入报告确认，避免后续默认变化换脑。无法确定 provider 的恢复猜测不得静默采纳。
3. 密钥由显式导入流程写新 secret store，验证已迁移后再决定清理旧文件；未使用 key、已删除 account 和环境覆盖均列报告。可重复导入按 legacy ID 去重，不自动合并账号。
4. 上线 HTTP 表单、草稿 Bot、Runtime 测试、绑定生效与停用，跑真实 HTTP 回合。
5. 迁移 coordinator 全局分支到对应 BotRuntime：保留原 transcript 来源映射，接入同一工具/取消/预算系统。Codex direct 与新 CLI adapter 独立验收；不把两者的历史 ID/认证混为一套。
6. 全部入口使用 Bot binding 后才停用旧全局模型执行路由。保留只读旧资料及回退备份；任何未迁移 Bot 明确标 migration_required，不在新系统悄悄代选模型。

开发复用位置以事实审计为准：`inference-vendor.ts` 拆公共 DTO；`SandSettingsStore` 用于导入；`resolve-inference.ts` 的精确绑定失败语义保留；`provider-session.ts` 拆 HTTP/CLI/legacy adapters；`coordinator/inference-router.ts` 的模型执行退出 coordinator。不要将其旧 200 条文本记录升级成“全部长期记忆”。

## 10. 首版验收

| ID | 必须证明的行为 |
| --- | --- |
| M01 | 无模型、无 Bot 的全新 workspace 能保存连接、做非推理探测、创建草稿 Runtime，再完成真实测试与第一条回复 |
| M02 | 同厂商两个 key/endpoint/model 实例独立；某实例 key 缺失不能落到另一个实例或预设 key |
| M03 | OpenAI/OpenRouter/DeepSeek 各一个真实获授权 modelId，以及一个 Custom compatible endpoint；记录日期、modelId、adapter 版本与能力，不要求硬编码永久模型名单 |
| M04 | 每 Bot 私聊、群、Routine、摘要均用同一绑定；全局默认改变不影响已有 Bot；不存在桌面/Service 代跑 |
| M05 | 文本、工具往返、图片输入独立测试；纯文本成功不冒称视觉/工具成功；synthetic SendMessage 不算工具能力证据 |
| M06 | 错 key、无权限 model、路径错误、超时、429、截断流、无 usage 均有正确状态；不自动换厂商、模型或账号 |
| M07 | 修改配置 next_attempt 生效；旧 attempt 保留 snapshot；即时停用收束旧进程，unknown 不释放执行权 |
| M08 | Server 与 Runtime 分机时分别展示探测来源；Server 探测成功但 Runtime 无网仍不能 ready；节点内网地址可仅在 Runtime 验证 |
| M09 | CLI 在每 Bot 私有环境拥有独立配置/凭据/历史，官方 adapter 的工具桥、真实取消、后台进程监管在 amd64/arm64 实测 |
| M10 | Codex direct 兼容迁移不冒充 CLI；旧 profile、环境覆盖、文本历史有导入来源；不能等价迁移时明确保留配置与阻塞原因 |
| M11 | 凭据不出现在 GET/SSE/日志/导出；替换/清除幂等；删除有引用厂商被拒绝，删除不会由旧 secret 自动复活 |
| M12 | 目录刷新失败不清空手填模型；新增模型需要自己的能力证据；CLI/协议/目录能力未验证时 UI 不显示正式支持 |

现有测试可作为回归输入，但当前正则断言与 mock SSE 不替代 M01–M12。开发者在发布清单填入实测结果；本文没有声称这些目标已由现有代码实现或本次已调用真实厂商验证。
