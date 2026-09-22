# BeeBot 开发技术栈与现有项目改造路线

版本：1.0 · 2026-09-17 · 状态：基于源码核对确定的待实施方案。

先读 [现有实现核对](./EXISTING_BEEBOT_IMPLEMENTATION_AUDIT.md)。本文回答开发语言、框架、是否重写、复用范围、构建和迁移；群行为与运行边界仍由 [主规格](./BEEBOT_SWARM_DESIGN_AND_DEVELOPMENT.md) 定义。

## 1. 已确定的开发选择

**在现有 BeeBot 仓库中渐进改造；主语言继续使用 TypeScript。保留已验证的 Bot 执行和持久化能力，新增独立 Web/Service/Node 入口，按边界替换桌面耦合和群调度。禁止先删除项目再从聊天样例重写。**

| 决策 | 首版选择 | 依据与限制 |
| --- | --- | --- |
| 仓库 | 继续使用当前仓库和 Git 历史 | 已有模型适配、工具、会话、群、UI 和测试；保留用户工作树改动 |
| 主要语言 | TypeScript，前后端 strict | 延续已有数据类型和协议；不新增 Python/Go/Java 后端实现同一业务 |
| Web | React + Vite 单页应用 | 复用当前 React 编辑器、消息组件、controller；新 Web 入口独立于 DesktopBridge |
| 样式 | CSS + 统一 tokens，沿用可复用组件 | 精修布局与状态；本次不为换栈整体改用另一套 UI 框架 |
| 国际化 | i18next + react-i18next，JSON v4 + Intl | 中英资源随Web打包；偏好与Bot/群输出语言分离 |
| Service / Node / BotRuntime | Node.js + TypeScript，独立入口与依赖图 | Node26 与当前 engines 对齐；Bot 模型仍在自己的执行端 |
| HTTP | 现有 Node HTTP/HTTPS 能力 + 明确路由表 + Zod 校验 | 新用户 API 单独实现，不直接开放旧 gateway method 任意转发 |
| 实时连接 | 浏览器 HTTP + SSE；节点 WSS；画面独立授权通道 | 使用现有 ws 能力；设置事件复用同一 SSE 契约 |
| 数据 | Service `control.db` 用 SQLite；每 Bot 私有 SQLite/文件继续独立 | 单可写 Service 首版不引入 Redis/Kafka/Postgres 集群依赖 |
| 文件 | 每 Bot 持久卷；共享成果按版本上传到 Service 文件存储 | 不靠共享宿主目录做跨节点协作 |
| 构建 | esbuild 构建 Node 角色，Vite 构建 Web，Docker 多阶段镜像 | 三镜像两部署包；不分三套 OS 业务源码 |
| 测试 | 现有 node:test + TypeScript；新增真实 API/SQLite/网络测试及 Playwright Web E2E | 不用只匹配源码字符串的测试冒充行为验证 |
| 部署 | `compose.server.yaml`、`compose.node.yaml` | Docker 跨 Windows/Mac/Linux，首版支持跨机器 |

Python、Shell、浏览器等仍可作为 Bot 电脑里的工作工具；这不改变 BeeBot 自身的开发语言。Dockerfile/YAML、CSS、SQL 是对应层的配置或资源。

依赖版本以当前 `package-lock.json` 为迁移基线，开发起点沿用已检查的 Node 26.5.0；发布 CI 锁定经过验证的精确 Node 补丁版本和镜像 digest。这里没有宣称 Node 26 是 LTS，也不因为此次 Web 改造批量升级 SDK/React/Vite。必要版本调整单独提交，验证原生依赖与数据库恢复。

`node:sqlite` 的 `DatabaseSync` 是同步接口；Service 使用专属数据库线程与有界请求队列，事务在同一连接内执行，文件上传和模型流不占据数据库事务。备份使用支持的 SQLite backup 接口或停止写入后备份，不能复制活跃 WAL 的单个主文件。具体方法按锁定 Node 版本验证。[Node SQLite 文档](https://nodejs.org/api/sqlite.html)

## 2. 保留、改造、新增、退出的边界

| 现有部分 | 决定 | 实施方式与验收 |
| --- | --- | --- |
| `source/host/runner/`、`source/packages/agent/` | 保留并适配 | 每 BotRuntime 使用现有 Runner/工具回合；真实工具结果继续进入模型上下文 |
| `source/host/extensions/session/`、私有记忆 | 保留私有存储能力 | 独立 Bot 私有数据根；移出公共群状态；稳定 ID、历史和记忆不丢失 |
| `source/host/extensions/inference/` | 复用并统一入口 | Host 与旧 coordinator 的分歧统一为每 Bot resolver；DM/群/Routine用相同配置 |
| `source/shared/inference-vendor.ts`、设置验证 | 迁移 | 保留厂商预设、手动模型 ID 与每 Bot 绑定，增加明确 provider/model 契约 |
| Shell、浏览器、MCP、附件工具 | 复用工具语义 | 改为当前Bot凭证、路径和能力范围；跨Bot私有存储/电脑访问拒绝；合法协作经Service授权命令 |
| `group-chat-orchestrator.ts` | 替换其循环调度 | 新持久协作引擎控制参与、认领、交接、预算和交付；保留成员独立 Runner |
| `group-chat-glue.ts` | 拆分职责 | 流式展示、公开消息提交、每 Bot attempt 适配分开，不把预览当持久提交 |
| 活动 session / transcript 单缓存 | 改造 | 每 conversation 明确 ID，浏览器焦点不修改全局读写对象 |
| `frontend/src/recovered/features/` | 按依赖复用 | 可独立的消息/编辑器/成员组件抽取；桌面容器与桥调用换服务接口 |
| `ProductionRenderer.tsx` | 拆分组合层 | 新 Web shell 组合已有组件；不在数千行桌面组合组件上继续补全局分支 |
| `scripts/lib/*snippet*`、旧 renderer | 仅作旧行为与迁移参考 | Web 新功能落在 React 源码，不能继续注入 DOM 补丁作为正式实现 |
| Electron main / preload / macOS 包 | 退出新产品运行路径 | 旧源码和验证暂留供回归/迁移；不发布新的桌面客户端 |
| 旧固定 Docker connector | 替换生命周期所有者 | Node RuntimeManager 管理每 Bot 环境；沿用可用的工具协议与健康检查 |
| 账号/群公共数据库/独立节点授权 | 新增 | 用户会话与节点/Bot 身份分离，不继承 Cursor 登录作为 BeeBot 用户账号 |
| 独立 Web 服务、屏幕授权代理 | 新增 | 同源页面/API；电脑流通过授权节点转发；跨机器与接管实际验收 |

目录名含 recovered 不表示全部不可用，名字含 production 也不证明所有能力已经接通。以真实入口、依赖图、调用链和对应测试作为复用依据。

现有 `host-runner-composition.ts` 的 SendToAgent、创建/更新Bot和同事查询直接调用同Host的transcript能力，拆分后不能原样保留。同事查询只返回已授权公共身份；群内SendToAgent意图转换为WorkItem/InputRequest或公开消息；创建Bot必须绑定可追踪的用户授权、模型/节点和资源限制，缺授权时形成用户决策，不由模型任意扩张电脑数量。正常群内协作不反复要求Boss派工；授权边界不能靠复制整个Host目录解决。

## 3. 新工程入口与构建规则

沿用现有 `frontend/`、`source/`、`tests/`、根 npm 锁文件。首版不进行无必要的全仓搬家或更换包管理器。

```text
frontend/src/web/              # Web bootstrap、shell、routes、设置与引导
frontend/src/services/         # 用户 API、SSE、会话与资源客户端
frontend/src/i18n/             # 完整界面翻译，资源按语言设置规格实现
frontend/vite.web.config.ts    # 不读取 src/app/dist 的独立开发/构建配置
source/service/               # 用户 API、公共业务、节点登记、事件流
source/domain/                # 群公共状态机、认领、预算、权限规则
source/storage/               # 公共 SQLite repository、迁移、数据库线程
source/node-agent/            # 主动网络连接与节点身份
source/runtime-manager/       # 仅此角色访问本节点 Docker
source/bot-runtime/           # 按 Bot 组合旧 Host/Runner/provider/私有状态
source/shared/contracts/      # 运行时 schema 与从 schema 推导的 DTO
deploy/docker/                # server/node/bot 构建目标与两个 Compose 入口
scripts/web-*.mjs              # 可移植开发、构建、迁移和诊断命令
```

这是目标目录，未表示已存在。可以从旧目录导入经验证的模块，待迁移完成再删除重复代码；禁止复制出两个长期维护的 Runner 或 provider 实现。

新增入口必须建立下列依赖约束：

- Web 构建不能导入 Electron、Node fs、Host 或 Docker 实现；只依赖 contracts、浏览器 services 和纯组件。
- Service 不导入 BotRunner/provider 执行器或私有 memory store；provider 管理 DTO 不等于推理执行模块。
- NodeAgent 不导入模型执行循环；旧 coordinator 的推理路由迁往 BotRuntime，不随文件名称整体复用。
- BotRuntime 不导入 Electron、公共 Service 数据库或其他 Bot 的数据目录。
- 旧包、ASAR、DMG、`src/app/dist`、开发者个人 home 不能成为新镜像构建输入；公共 npm/OS 包与经过记录的源码资源单独获取。

新 Web config 使用真实 Web base/path、静态资源与 SPA fallback。开发代理只负责转发 API/SSE；生产由 Service 提供静态产物，不能发布 Vite dev server。[Vite 生产构建说明](https://vite.dev/guide/build.html)

保留根 lockfile，镜像使用多阶段安装/编译；最终层只包含各角色实际所需 bundle、受控资源和精确依赖清单。Electron 下载在新角色构建中明确禁用，原生 parser 在目标 Linux 架构按 Node ABI 构建；禁止把 Mac 的 node_modules 复制进镜像。P0 的依赖闭包测试必须证明这一点，不以 `external: ['electron']` 掩盖运行时 import。

复用Bot不是只产出host-main.cjs。当前构建另外输出agent-store、transcript-mirror、box-store-vacuum、search-index四个worker；会话池通过相对路径加载worker。P0列出每个保留worker的入口、输出路径与所属角色，禁用的云同步worker有明确处置，不能esbuild成功就算完整。浏览器驱动还动态加载playwright-core并依赖box-chrome等镜像程序：必须把实际依赖加入对应锁定清单和镜像，不从开发机或旧镜像偶然取得。P3分别验收新会话、重启恢复历史、真实浏览器打开/截图/输入，双架构使用同一清单。

## 4. 目标开发命令与第一次可运行交付

以下命令必须在 P0/P1 实现后提供；当前仓库没有这些脚本，不是今天可直接运行的教程。

| 命令 | 目标 |
| --- | --- |
| `npm run web:dev` | 启动可访问的 Web 开发入口，配置 Service URL，支持无节点空状态 |
| `npm run service:dev` | 启动独立公共 Service，使用任务专用数据根 |
| `npm run node:dev` | 启动节点管理端，要求显式服务地址和独立登记身份 |
| `npm run web:build` | 只从源码和声明资源编译新 Web |
| `npm run runtime:build` | 分别构建 server/node/bot，不打 ASAR |
| `npm run web:check` | 新 Web/三角色类型、契约和依赖边界检查 |
| `npm run web:test` | 新公共 API、网络、SQLite 和协作行为回归 |
| `npm run web:e2e` | 普通浏览器的真实首用、设置、群、接管与重连 |
| `npm run migration:plan` / `migration:apply` | 显式源目录、备份、预演与执行，默认不更改旧数据 |

CLI 脚本用 Node `.mjs` 处理路径和进程，不依赖 Bash 才能使用；Docker 中的启动脚本可以用 Linux Shell。开发者可以在 Docker 内安装构建依赖，最终用户只需要 Docker 和浏览器。

首个切片必须能演示：独立 Service 启动 → Web 初始化 owner 与语言 → 保存一个现有兼容 HTTP 接入 → 登记远端节点 → 创建一个带绑定的 Bot → Runtime 调用真实模型并使用一个电脑工具 → Web 收到持久结果。只有群视觉 mock 或只打印 `hello` 的三个容器不算完成。

## 5. 模型与语言是产品基本流程

厂商/模型配置的入口、字段、验证、测试位置、绑定生效时机、凭据和旧数据迁移详见 [厂商与模型配置规格](./MODEL_PROVIDER_CONFIGURATION.md)。不能让用户编辑宿主 JSON 或先在开发机登录才能完成首次使用。

界面语言、Bot 回复语言、群交付语言、时区和完整设置导航详见 [语言与设置规格](./LANGUAGE_AND_SETTINGS_DESIGN.md)。迁移保留旧 `en/zh`，新产品将 UI 显示偏好与模型输出偏好分开。

这些不是收尾阶段的可选设置页；它们在第一条 Bot 消息之前就要能使用，并进入模型路由、配置版本与验收。UI 的“保存成功”必须意味着 Service 已持久接受，不能只改本地显示。

## 6. 已有能力怎样处理

首版不承诺旧官方账号附加功能自动具备自托管替代品。每项能力必须有明确落点，不能保留一个点击无反应的入口。

| 能力 | 本次处理 |
| --- | --- |
| Bot 身份、记忆、私聊、群、附件、工具、使用量 | 首版核心；保留语义并完成新边界迁移 |
| HTTP厂商与每 Bot 选择 | 首版核心；完整配置与实际回合验证 |
| Claude/Codex 账号路径 | 按模型规格标明现状与目标 adapter，缺能力明确阻塞，不能伪装成已支持的 HTTP 接入 |
| 用户创建的 workflows/skills、Bot MCP 配置 | 保留文件/配置与工具入口，逐 Bot 重新授权；无法连接时显示诊断，不默认复制凭据 |
| 私有长期记忆 | Bot 端持久；用户可查看/删除自己的 Bot 记忆，修改经受控运行时接口 |
| 显式 user/project 共享记忆 | 迁移前保留 scope 与写入者；通过授权共享记录迁移，禁止扇出整个共享数据根 |
| routines 定义和历史 | 必须保留，导入默认暂停；由新 Service 独占触发权，迁移不能同时启动旧云调度和新调度 |
| 原云账号专用 search/fetch、共享房间、自动评审、云同步 | 不假定独立可用；界面隐藏不可用操作，保留迁移说明，替代能力单独验证后开放 |
| macOS全局快捷键、托盘、原生通知/更新器 | 新产品退出；首版使用浏览器内快捷键与页内状态消息，不提供未实现的系统推送开关 |
| 宿主真实桌面、Keychain、原生应用 | 不属于默认 Linux Bot 电脑；现有 local-exec 能力作为后续明确授权适配，不自动暴露 |

首版基础 routine 范围为单 Bot 的用户定义定时任务：Service 保存 schedule/timeZone 和唯一触发记录，经同一 per-Bot attempt 队列投递；模型与工具仍在 BotRuntime。一次触发用稳定 ID 去重，离线期间过期触发默认合并成一次待执行并显示漏过次数，不集中补跑所有历史副作用；停用阻止新触发，在途工作另行停止。复杂外部事件渠道按能力另行开放。Group 日常指令不要求配置 Routine。

基础Routine新增/读取/修改/停用使用workspace前缀下 `/bots/{botId}/routines` 与 `/bots/{botId}/routines/{id}` 的POST/GET/PATCH/DELETE；保存instruction、schedule、timeZone、enabled、revision、模型绑定引用和下一次触发时间。schedule格式优先适配现有解析器，并在P0锁定共享schema和时区/DST行为，UI保存前显示接下来三次触发。触发记录唯一键为routineId+scheduledAt，先事务持久化再入队；修改调度不追溯重写已接受触发。DELETE按停用并归档处理，不删除历史。在途unknown阻止相同Bot重复副作用；普通失败由用户显式重试，Service重启不无条件重跑。

上述范围只规定迁移与运行落点，已有工作流/定时器解析优先复用。实施 P0 必须产出一张逐 feature 的入口、依赖、状态和迁移映射；发现新的旧功能时补映射，不能悄悄删除。

## 7. 数据迁移和旧代码删除条件

1. 使用任务分支或隔离 worktree；先记录用户现有改动与测试基线，不能清理未提交文件。
2. 对 Bot/Group、profile、厂商记录、settings、secret引用、SQLite/blobs、记忆分域、workflow/routine、文件与登录归属做预演清单。未知旧字段保存在迁移原件中。
3. 新数据根与旧目录分开。普通升级不自动启用新模型回合或旧定时任务，不复制用户完整 `.codex/.claude`、浏览器 home 给所有 Bot。
4. 验证“旧 ID → 新 ID/引用”的稳定映射；每个旧 vendor account 至少保留自己的名字、endpoint 和 modelId，不通过相似名称合并。
5. 切换时停止旧写入者和执行，保存一致备份，再导入并启用新服务。迁移幂等，不能同时存在同一 Bot 两个有效执行者。
6. 验证私聊、历史、模型选择、语言、记忆、文件和登录后才切换默认入口；旧数据保留到显式清理。
7. 删除旧桌面代码的条件：新源码依赖闭包不再引用，能力表已处理，迁移与回滚已验证，相关旧测试有明确退役说明。按模块删除，不批量清空 `source/host`、`frontend` 或历史证据。

“不再交付桌面客户端”与“立刻删除所有桌面源码”是两个不同操作。前者是产品范围，后者必须等依赖迁移完成。当前阶段只制定文档，不执行删除。

## 8. 工作包与验收证据

沿用主规格 P0–P5，给每个包补充硬性输出：

- **P0**：源码事实清单、既有行为基线、角色依赖图、新构建入口、可脱离旧安装包的 Linux 构建证据。
- **P1**：用户账号、设置/provider管理、公共数据/事件、节点登记；Service 独立启动，无节点也能配置和查历史。
- **P2**：完整首次使用、中英设置、精致 Web 组件及所有错误/空状态；普通浏览器无需桌面桥。
- **P3**：复用完整 Bot Runner 和工具；每 Bot 单独解析 provider/model；两台电脑隔离，接管与私有数据恢复。
- **P4**：以现有成员 Runner 为执行单位，替换群全员回声循环；公开协作状态持久化。
- **P5**：迁移/回滚、三平台双架构、跨节点真网络、真实模型工具、设置跨设备与视觉验收。

现有 `npm run check`、`frontend:build` 是旧基线检查，仍需保护；新 Web 发布必须再有自己的检查。Playwright 用于 Chromium/Firefox/WebKit 浏览器流程和屏幕截图，电脑工具/远端屏幕仍需真实运行端验收，不能以浏览器 mock 代替。[Playwright 官方说明](https://playwright.dev/docs/intro)

以下验证门槛尚未完成：新角色的完整无旧包构建、Linux双架构原生依赖、CLI adapter的工具闭环、临时root安装与监管隔离、真实跨节点恢复。它们是明确开发任务，不是让下一位 AI 随意决定技术栈的空白，也不得在完成前标记首版已可发布。
