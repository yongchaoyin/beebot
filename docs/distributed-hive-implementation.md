# 分布式蜂群实施记录

2026-09-19：按用户最新决定恢复开发，首轮仅交付 **Mac 客户端与独立服务端的执行闭环**。Windows、iOS、Android 留待这条链路稳定之后。

目标架构见[实施前决策基线](distributed-hive-decisions.md)与[连接认证和故障恢复设计](client-connectivity-and-recovery.md)。这些文档包含后续阶段，不能视为已经实现的功能。实际使用入口见[服务端运行与部署](node-server.md)。

## 本轮实现

- 同一仓库、独立构建运行：现有 Electron Mac 客户端；无 Electron、无上游应用运行时依赖的 Node 服务端。
- Mac 正式 renderer 的 **设置 → 服务器（Settings → Servers）** 负责添加多个节点与系统浏览器登录；主侧栏底部不再提供连接管理入口。主列表 + → New bot 使用原创建页选择本机或 Server。远端 Bot 进入主列表，复用原聊天位置与 Header/Transcript/Composer，可发送消息、查看回复、停止执行和核查中断。
- Server 与 Bot 为一对多关系。“新建 Bot”显式选择部署服务器，并保留名称与头像设置；成功后选中主列表中的新实例。聊天记录限定于该 Bot，掉线不会切换到其他 Server 或 Bot。本机 New group chat 继续只包含本机成员。
- 原生 OAuth Authorization Code + PKCE S256；每个节点独立 Owner，设备会话、refresh token 旋转和撤销。refresh token 由 Electron safeStorage 保存，不进入 renderer。
- 独立 Bot 的持久身份、会话和工作目录；同 Bot 顺序执行，不同 Bot 可并行。
- 明确分离 Goal、Task 与 Run。首轮每个 Goal 一个 Task，执行完成进入 `review`，用户验收后才是 `succeeded`。
- SQLite FULL/WAL 持久化；命令去重、目标状态和事件同事务提交；数据目录单写入者锁；事件票据与游标恢复。
- Mac 退出后服务端继续；服务端重启后恢复身份与历史，排队任务可继续。执行中断进入 `uncertain`，阻断该 Bot 的后续执行。
- 取消先进入 `cancelling`，实际回收 Host、执行 daemon 与 Shell 后代；可能存在外部副作用时仍需核查，不伪称回滚成功。
- Owner 输入核查说明后可恢复原 Bot。旧 Run 不重发，旧目标关闭为失败，保留身份、记忆和工作目录，后续目标使用新 Run。
- 独立构建命令、CLI 配置、Docker/Caddy 部署文件和操作文档。

## 工程入口

| 层 | 主要源码 |
| --- | --- |
| Mac 连接、PKCE 与安全存储 | `source/client-connections/` |
| Electron 主进程桥接 | `source/electron-main/beebot-node/connection-ipc.ts` |
| 主列表 New bot 原入口 | `scripts/lib/sand-create-overlay.snippet.js` |
| 远端 Bot 主列表与连接目录 | `scripts/lib/beebot-node-sidebar.snippet.js` |
| Settings → Servers 连接管理 | `scripts/lib/beebot-node-workbench.snippet.js` |
| 远端聊天控制与原路由挂载 | `scripts/lib/beebot-node-chat-controller.snippet.js`、`beebot-node-chat-route.snippet.js` |
| 复用现有聊天组件 | `frontend/src/node-chat/` |
| 公共控制 API | `source/node/server.ts` |
| 本地 Owner 认证 | `source/node/auth.ts` |
| 目标/任务/运行账本 | `source/node/control-store.ts` |
| 调度与人工核查 | `source/node/control-service.ts` |
| 每个 Bot 的真实 Host | `source/node/runtime.ts` |
| 独立构建 | `scripts/build-node.mjs` |

## 当前边界

本轮是可信单 Owner 自托管节点。Bot 工作目录隔离用于组织与持久化，**不是跨用户安全沙箱**；工具能访问部署账号有权访问的资源。把 B 的服务器向不可信 A 开放，需要后续租户、模板发布/导入、资源额度与安全沙箱，当前不能以多个目录代替。

多服务器连接已经进入 Mac 客户端；**Bot 自动跨服务器委派、故障接替、成果复制、Hive 控制面高可用尚未实现**。目前节点停止时，客户端会显示断线，其上的运行不会由另一个节点自动接替。不能把客户端多连接误称为完整蜂群协同。

首轮服务器协议支持文字消息与记录；聊天页复用原组件，只显示当前远端已支持的操作。执行中显示真实状态，服务端结束本轮后返回回复，尚不提供逐字流式增量。本地完整桌面原有能力保留。跨节点文件成果下载、交互式审批/问答、动态任务 DAG、Bot 模板升级与迁移仍待后续阶段。模型请求用户互动但协议尚不支持时进入待核查，不作为成功结果。

首次使用的完全空白 Mac profile 仍有待适配的入口边界：Node 登录不会完成原本的本机模型引导，主 Bot 列表仍受旧启动流程控制。本轮已在现有主界面中接通远端聊天；纯远端客户端的首次引导需要独立处理，不能通过伪造本地模型账号或密钥解决。

## 验证

- `npm run check`：前端与源代码类型检查、既有回归、新增认证、连接、工作台与控制层测试。
- `npm run node:test:integration`：真实 Host、真实 Shell、独立目录、持久身份、同 Run 去重、执行失败、进程回收、人工核查、可控 HTTP 模型端点与控制器被杀后的子进程回收。
- 同一集成命令包含 Mac 使用的连接模块 → PKCE → Node → Host → 客户端断线 → 事件重放 → 结果验收 → 服务端重启完整链路。
- 正式 Mac 打包与隔离 profile 原生界面验证；部署配置校验。具体 Linux 容器运行与云端证书状态见运行文档，不能把本机测试写作云端部署完成。

测试模型为确定性替身与本机 HTTP 模型端点；Host、工具、网络、数据库和进程均真实运行。没有调用真实用户模型账号，也没有修改原来的应用配置。

### 本轮验收结果（2026-09-19）

本次连接管理移入 **Settings → Servers** 后，原生回归发现并修复了打包时同一 main chunk 的后续变换覆盖设置注册的问题。组合打包测试验证 Servers、Router 和原聊天入口同时保留，最终 ASAR 也已核对。

前后端类型检查通过，最终测试 146 项中 137 项通过、9 项按条件跳过；独立真实运行集成测试 13/13 通过，包含上述条件测试。隐藏 Chromium 的真实授权表单、回调和 PKCE 交换通过。`dist/BeeBot.app` 已重新打包并通过严格签名校验。

原隔离测试 profile 缺少本机初始化配置，旧包同环境也回到模型配置页；没有修改该 profile 的初始化信息。最终安装包的界面回归使用独立的已初始化测试 fixture，显式禁用本机 Docker 路径，不创建本机 Bot、不使用真实模型密钥。CUA 的控件树与截图不同步后，通过该临时实例的 CDP 完成真实 DOM 点击和输入验证；此结果不覆盖操作系统键盘输入或纯远端首次启动引导。

- Settings → Servers 已在原设置页内渲染，侧栏底部没有服务器入口。A、B 均在线；主列表显示 A 的三个 Bot 和 B 的一个 Bot，用户原有“而为”保留。
- Docker B 聊天显示六条历史消息，对应三个 `succeeded` 目标。打开、关闭 Settings，以及原 + → New bot → 选择 B → 取消后，当前 Bot、历史消息和中文草稿保持不变。
- New bot 的部署选项包含 This Mac、A、B；选择远端 Server 后隐藏本机 API 配置。通过 CDP Input 录入中文草稿，并以 Backspace 清空，未提交消息。
- 已检查 Settings、New bot 和远端聊天截图；本轮界面回归未新增 Bot 或任务。两个临时设备会话均已从服务端撤销，测试应用已恢复使用原隔离 profile。

下列记录为此前已完成的验证：

- `npm run check` 通过：类型检查通过，142 项测试中 133 项通过、9 项按条件跳过；需要真实进程的集成项由下述独立运行覆盖。原入口回归验证本机/远端路由、头像、幂等重试、本机群聊隔离与显式目标离线不改派；主列表验证原生滚动挂载、缓存身份与退出竞态、慢服务器不阻塞其他服务器显示。
- 完整集成运行 13/13 通过。包含非幂等 Shell 写入的精确次数、控制进程被杀、回执写入失败、连续终止信号与 Shell 后代回收。
- Mac 原生界面通过系统浏览器登录，创建 Bot、提交目标、看到运行和待验收状态、验收为完成；已从服务端工作目录读取 `native-smoke.txt` 确认真实文件内容。
- 远端聊天正式挂入原 `qLn` 聊天位置，组件复用和请求隔离回归通过；原生截图验证正常聊天布局，真实聊天控制器经独立 PKCE 会话在 Docker B 完成一条 Shell 消息和验收。原生键盘输入测试因窗口焦点切换而暂停，不视为已通过。
- 此前的 Mac 包也已完成 Host、执行器清理和工作台修改的打包验证。
- 最新源码构建的 Linux ARM64 镜像在非 root、无外网容器内完成 CLI、PKCE、真实 Shell 和重启持久化验收。
- 本机双 Server 演示已运行并接入 Mac。A 承载两个 Bot，B 承载一个；跨服务器创建、同 Server 多 Bot 的独立 Host 身份与实际工作目录均已通过真实界面和只读基线比较验证，见[演示说明](local-docker-demo.md)。

早期临时 Mac 验收服务已停止；两个 Docker 演示 Server 保留运行。执行真实业务任务需按运行文档配置真实模型接口，演示 fixture 只用于固定环境检查。

## 下一阶段

1. 独立模板修订与 A 自有 Bot 实例创建，明确 B 提供能力/计算的授权边界。
2. 跨 Node 信任、范围受限的 Bot 委派、持久 inbox/outbox、带版本的任务认领与 fencing。
3. 成果复制和可迁移执行检查点，验证节点故障、网络分区与不可重放副作用。
4. 在 Mac + Node 链路稳定后，再扩展其他客户端。

早期暂停的探索保留在忽略目录 `.build/hive-prototype-paused-20260919/`，没有把其未完成控制面恢复为正式实现。
