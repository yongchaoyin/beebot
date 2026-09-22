# BeeBot

[English](README.md) | 中文

BeeBot 是一个用于办公与生活协作的 macOS 本地电脑 Agent。你给出目标和边界，Bot 像同事
一样在同一台 Linux 电脑上协作。每个 Bot 有自己的身份、记忆和桌面，并使用
你为它选择的模型厂商。不需要 Cursor 账号，也不绑定 Cursor 云端。

本仓库与 Anysphere、Cursor、xAI、SpaceX 无关，也不是官方 Grok Bot 发行版。

现已增加第一轮 **Mac 客户端 + 独立服务端**。运行 `npm run node:build` 构建，
`npm run node:init` 初始化，配置模型后执行 `npm run node:start`；在 Mac 的
**设置 → 服务器（Settings → Servers）** 添加地址并登录，再从主 Bot 列表上方 **+ → 新建 Bot** 选择部署服务器。
远端 Bot 会出现在左侧主列表中。详见[运行说明](docs/node-server.md)和
[实施进度](docs/distributed-hive-implementation.md)。跨服务器自动委派与多用户托管
属于后续阶段，现有本地协作团队能力继续保留。

## 设计哲学

BeeBot 的核心是：你给出目标和边界，Bot 像同事一样自主分工、交换信息、
互相补位，共同完成交付。你随时可以介入；需要判断时，他们会把你找回来。

产品应让你感到：交代目标之后，一群了解你的同事开始协作。你不是必须盯着
会议的主持人。

### 每个 Bot 是长期个体

Bot 是同事，不是一次性工人。它有名字、专长、记忆和判断。工作越久越了解
你。只跑一步 GUI 或浏览器的临时子任务工人，不是协作团队成员。

### Group 是共同协作空间

成员共享目标、进展和成果，并知道同伴在做什么。聊天可以是这个空间的一种
表面，中心是共事，不是轮流发言。

### 分工由协作团队自己形成

你不必把工作拆成工单再逐个安排。成员根据能力和当前情况认领工作、请求
帮助、交接结果。

### 协调角色按需出现

你可以指定「这次由你负责」。成员也可以自然承担协调。角色随任务结束而
解散。没有必选的固定主管 Bot。

### 围绕整体成果行动

有价值时参与，需要时补位，没贡献时保持安静。系统应记住谁认了什么、做到
哪、结果在哪，避免重复劳动、无限讨论和无人收尾。

### 你怎么对他们说话

| 你说 | 产品应理解成 |
| --- | --- |
| 「大家把这件事完成。」 | 把目标和边界交给协作团队。他们自主协作，直到交付或需要你判断。 |
| 「@小研，查一下这个。」 | 定向任务，不是全员开工。 |
| 「@小策，这次你牵头。」 | 本任务的协调关系，不是升职。 |

默认是第一种。后两种是你介入的方式。交代完可以走开，也可以随时走进去改
目标、改边界、改谁牵头。卡住需要判断时，他们来找你，而不是在群里空转等
你碰巧看到。

### 共用一台电脑

协作团队共用一台持久的 Linux 机器。这是共事的物理形态，不是比喻。

- **共用：** `/workspace`、装过的工具、浏览器登录。一个 Bot 建好的文件或
  登录，别的都能用。更新和重置针对整台电脑。
- **分开：** 每个 Bot 有自己的桌面——自己的屏幕和浏览器窗口。打开某个 Bot
  的 Computer，看到的是它那块屏，看不到别人。它自己的 computer-use 子任务
  和它共用这块屏，所以同一时刻只能有一个在操作 GUI。
- **身份在共用盘上：** 每个 Bot 的人设和记忆在
  `/home/box/sand-data/agents/<botId>/`。因为在同一台机器上，队友仍可以读
  这些文件。
- **你的 Mac 是另一台电脑。** Bot 只能通过 CopyToBox / CopyFromBox，或经
  你批准的 ExternalShell 到达。

交接靠把成果留在共用机器上。`/workspace` 里的文件还没有锁或所有权模型，
两个 Bot 可以覆盖同一路径。

### 这不是什么

- 不是多 Agent 辩论赛。发言不是价值本身。
- 不是主管树。没有常设老板 Bot。
- 不是一次性工人池。
- 不是你当项目经理去拆每一项任务。

今天的 Group 仍是并发群聊（`@`、无话就 `(pass)`）。上面是产品北极星。
差距在于：从「一起说话」变成「一起交付」。

## 当前功能

### 本地电脑

所有 Bot 共用一台沙箱 Linux 电脑。**设置 → Router → Use local Docker VM**
会把这台电脑跑在本机 Docker 容器里（只监听 loopback，设置和 API key
以绑定挂载方式注入）。需要 Docker Desktop，或其他兼容的本地 Docker。
每个 Bot 在这台机器上有自己的桌面；文件、装过的工具和浏览器登录对整个
协作团队持久有效。

### 模型 API

打开 **设置 → Router → 模型 API**，可以添加多个厂商。每个模型都有自己的名称、
厂商、API key、Base URL 和模型 ID。密钥只保存在这台 Mac 上。

支持的 HTTP 厂商：

| 厂商 | 默认接口 |
| --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com` |
| 自定义 | 任意 OpenAI 兼容的 Base URL |

本机已经登录的 Claude Code / Codex 也可以作为本地 CLI 路由使用。

### 每个 Bot 使用自己的 API

**新建 Bot** 会让你起名字、选图标和颜色，并选择这个 Bot 使用哪一个已保存的
模型 API。之后也可以在 **Bot 设置** 里改。不同 Bot 可以走不同厂商，好发挥
各家模型的长处。

### 语言、群聊和桌面里的其他部分

- **设置 → Appearance → 语言** 在 English / 中文之间切换。界面文案跟随这项
  设置，不跟随操作系统语言。
- **+ → 新建群聊** 可以用现有 Bot 建群。
- 路由到 HTTP 模型时，插件、流式输出和本地用量统计仍然可用。只有 Cursor
  会话才提供的云端能力（网页搜索/抓取、自动审查）默认关闭。

## 来源

BeeBot 起步于对公开 Grok Bot 0.18.0 macOS 应用的非官方、面向源码的重建。
Electron、host、coordinator、本地执行和协议边界的可读 TypeScript 在
`source/` 下。打包后的应用仍以校验和钉死的 0.18 渲染器为 UI 基线，再叠一层
设置页和新建 Bot 的补丁。

Dock 名称和 bundle 标识是 BeeBot。界面里仍有部分文案写着 Grok Bot，因为那份
官方渲染器是按字节保留的。

BeeBot 原创部分使用 MIT 许可。重建得到的上游材料和保留的 0.18.0 安装包不在
该授权范围内。详见 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md) 和
[PROVENANCE.md](PROVENANCE.md)。

## 环境要求

- Apple Silicon 上的 macOS
- Node.js 26.5.x
- Xcode Command Line Tools
- Git LFS
- Docker Desktop（本地电脑）
- 若走 Claude Code / Codex 路由，需要本机已登录对应工具

## 快速开始

```sh
git clone https://github.com/yongchaoyin/beebot.git
cd beebot
git lfs install
git lfs pull
npm ci
npm run bootstrap
npm run check
npm run package
open dist/BeeBot.app
```

1. 在首次配置页粘贴厂商 API key（之后也可以在 **设置 → Router → 模型 API**
   里继续添加）。
2. 如未打开，打开 **Use local Docker VM**。
3. 新建 Bot，选好它使用的 API，然后发一条消息。

`npm run bootstrap` 会优先使用 Git LFS 里保存的 0.18.0 DMG。若本地没有这份
归档，再回退到原来的公开下载地址；也可以用 `GROK_BOT_018_APP` 指向已有的
应用副本。Bootstrap 会校验 DMG 和 `app.asar`，缓存对应的 Electron 运行时，
并填充被忽略的 `src/app/dist` 构建输入。

`npm run package` 会编译运行时、打上渲染器补丁、生成应用包、写入 BeeBot
bundle 标识、做 ad-hoc 签名并校验。产物在 `dist/BeeBot.app`。

打包构建会在打包边界关掉上游更新器，并默认关闭上游 Sentry 和遥测。显式提供
的环境配置仍然生效。

## 架构

```text
官方渲染器 + BeeBot 补丁
          │
          │ desktop preload / RPC
          ▼
     Electron main
          │
          ├── 设置、密钥、模型 API
          └── 本机 Docker 连接器
                       │
                       ▼
              coordinator + host
                       │
              按 Bot 选择的推理厂商
           ┌───────────┼───────────┐
     OpenRouter     OpenAI      DeepSeek / 自定义
                       │
              共用的一台 Linux 电脑
              （每个 Bot 在上面有自己的桌面）
```

主要源码目录：

- `source/electron-main/` — 桌面生命周期、设置、厂商密钥、沙箱连接、
  coordinator 和 RPC；
- `source/electron-preload/` — 暴露给 UI 的窄桥；
- `source/host/` — 推理、工具、MCP、设置和一轮对话的执行；
- `source/node-agent-coordinator/` — 对话记录、流式状态、反应和 MCP 桥；
- `source/shared/` — 共享契约、设置、协议和厂商辅助；
- `frontend/` — 可读的 React/TypeScript 渲染器重建；
- `scripts/` — 引导、编译、渲染器补丁、打包、签名和校验；
- `tests/` — 发布与路由回归。

更细的说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 开发命令

```sh
npm test                  # 聚焦回归测试
npm run typecheck         # 渲染器 TypeScript
npm run source:typecheck  # 运行时 TypeScript
npm run frontend:build    # 构建可读渲染器重建
npm run package           # 构建、签名并校验 macOS 应用
npm run verify            # 校验已有打包应用
npm run smoke             # 有界的原生冒烟检查
npm run publication:check # 证明干净历史导出无损
```

`.cache`、`.build`、`dist`、`src/app/dist`、`recovered`、`recovery` 以及本地
探测目录都会被忽略。

## 项目状态

应用可以启动，核心流程可用：共用一台本地 Docker 电脑、多个模型 API、按 Bot
选厂商。上面的协作团队协作是北极星；今天的 Group 仍是群聊。目前仍是实验性项目，
只针对钉死的一份 macOS/arm64 运行时，不承诺兼容后续官方 Grok Bot 版本。
飞书、QQ 这类消息网关还在规划中，尚未进仓库。

改代码请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。干净历史导出流程见
[docs/PUBLISHING.md](docs/PUBLISHING.md)。
