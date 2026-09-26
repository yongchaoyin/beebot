<img src="branding/beebot-app-icon.svg" alt="BeeBot" width="88">

# BeeBot

[English](README.md) | 中文

BeeBot 是一个 macOS 上的 AI 同事工作空间。你可以和一个 Bot 单独交谈，也可以
把几个 Bot 放进群聊，交代目标和边界，在对话里跟进工作。Bot 会持续保留自己的
身份、记忆和工作上下文。

你可以选择模型厂商，在本机电脑环境中执行任务，也可以连接独立部署的 BeeBot
Node。使用 BeeBot 不需要 Cursor 账号。

[构建桌面应用](#快速开始) · [运行服务端](docs/node-server.md) ·
[架构说明](docs/ARCHITECTURE.md) · [参与开发](CONTRIBUTING.md)

## 像同事一样共事

每个 Bot 都能独立工作。群聊是共同的工作空间：真实的 Bot 互相发消息、请求帮助、
交接成果。协调关系跟随当前任务，不需要常设主管。工作进行时，你可以继续聊天、
补充信息或介入调整。

| 你说 | 期望的交互 |
| --- | --- |
| 「大家把这件事完成。」 | 把目标和边界交给团队。 |
| 「@小研，查一下这个。」 | 定向请一位同事处理。 |
| 「@小策，这次你牵头。」 | 请一位同事协调当前任务。 |

产品的目标是让 Bot 负责把工作推进到交付，需要判断时再找你，普通聊天保持自然。
实际判断和任务完成质量仍取决于配置的模型及可用工具。

## 当前桌面体验

### 聊天与协作

- **单 Bot 与本机群聊：** 持久对话、引用回复、定向提及，以及工作期间继续补充
  消息。富文本输入框使用一套带头像的 `@` 列表。
- **本机 Bot 有明确的主要职责：** 新建或编辑时确认职责、排除事项和预期交付物。
  职责版本与名字、人设、模型分开保存，旧 Bot 的配置继续保留。
- **有记录的分工和交付：** 本机 Bot 可以分配、认领任务，跟踪前置工作，发布成果，
  自行检查完成标准或请指定同事复核。检查对应当前版本的成果和依据。
- **只读协作面板：** 查看负责人、进度、阻塞、完成标准和成果预览，已完成工作单独
  折叠。面板自动更新，日常本机任务不再要求你操作验收或刷新按钮；需要你决策或
  实际授权时，仍在聊天里沟通。

上述协作和主要职责功能属于本机 Host。远端 Node 协议使用独立任务记录，仍保留
结果确认流程。职责描述或 Bot 自检不会增加工具权限，也不证明模型结论一定正确。

详见[同事协作](docs/implementation/natural-colleague-attention.md)、
[主要职责](docs/implementation/bot-primary-job.md)、
[进度面板](docs/implementation/colleague-progress-and-completion.md)和
[任务收尾](docs/implementation/colleague-completion.md)。

### 中英文界面与动态头像

在 **设置 → 通用 → 外观 → 语言** 切换 English / 中文。设置、应用菜单和聊天控件
跟随应用语言；消息原文、Bot 名称、模型标识和未发送草稿保持原样。界面语言与 Bot
回复语言独立，上游错误详情保留原文。macOS 自行加入菜单的系统项目跟随操作系统语言。

界面支持浅色和深色外观，使用中性底色和少量蓝色强调。八种头像轮廓共享表情和
工作动作。头像编辑器中的「自然」模式会让列表里可见的空闲 Bot 偶尔做短暂表情，
工作中的动作优先；也可以选择「轻微」或「关闭」。系统减少动态效果、窗口焦点与
可见性设置会被遵守。历史消息头像和群头像拼图保持静止，自定义照片继续可用。
应用与 Dock 图标使用绿色 Bot 形象。

详见[双语支持](docs/implementation/ui-language-completion.md)、
[表情动作](docs/implementation/presence-expressions.md)和
[列表动效与绿色图标](docs/implementation/sidebar-presence-and-green-icon.md)。

### 模型与执行环境

**本机 Bot** 在 **设置 → 模型路由 → 模型 API** 中配置名称、厂商、API key、
Base URL 和模型 ID，再为每个 Bot 选择模型 API。模型凭据保存在 Mac 上。
支持的 HTTP 路由包括：

| 厂商 | 默认接口 |
| --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com` |
| 自定义 | 兼容 OpenAI 的 Base URL |

Claude Code 可以复用本机登录。Codex 路由复用本机 Codex CLI 保存的 ChatGPT 登录，
由 BeeBot 直接发送请求。HTTP 模型路由支持插件、流式输出和本地用量统计；上游专有
云服务仍需要对应的上游会话。

| 部署方式 | 执行环境和模型配置 |
| --- | --- |
| 本机电脑 | Bot 共用这台 Mac 上持久运行的 Linux Docker 电脑，各自有桌面，文件、工具和浏览器登录共享。本机 Bot 可以分别选择模型 API。 |
| 独立 Node | Node 运行自己的 Host 进程、Bot 工作目录和服务端配置的模型，凭据由服务器管理。退出 Mac 客户端不会停止服务端。 |

本机共享文件不按 Bot 隔离；Node 的独立工作目录也不构成安全沙箱。
部署方式和信任边界详见[服务端指南](docs/node-server.md)。

## 快速开始

### 构建桌面应用

需要 Apple Silicon Mac、**Node.js 26.5.0**（见 [.node-version](.node-version)）、
Xcode Command Line Tools 和 Git LFS。本机电脑模式还需要运行兼容的本地 Docker
服务，例如 Docker Desktop。

```sh
git lfs install
git clone https://github.com/yongchaoyin/beebot.git
cd beebot
git lfs pull
npm ci
npm run bootstrap
npm run icon:generate
npm run package
npm run verify
open dist/BeeBot.app
```

`bootstrap` 校验固定运行时并准备被忽略的构建输入。`package` 执行完整源码检查、
构建运行时、应用已声明的渲染器适配，生成 ad-hoc 签名的 `dist/BeeBot.app`。
`verify` 校验包内容、身份和签名。上游自动更新已关闭；更新仓库源码后重新构建，
即可使用新的 BeeBot 版本。

### 先使用本机 Bot

1. 在首次配置页或 **设置 → 模型路由 → 模型 API** 中配置模型。
2. 启动本机 Docker 服务，并在模型路由中启用「使用本机 Docker 虚拟机」。
3. 从 **+ → 新建 Bot** 设置名字、头像、主要职责和模型 API，然后开始聊天。
4. 用 **+ → 新建群聊** 把已有的本机 Bot 放到一起。

本机模式下，团队共享 `/workspace`，每个 Bot 保留自己的桌面和持久身份。
Mac 本身是另一个执行环境，继续遵守已有权限设置。

### 连接独立 Node

Node 可以独立构建，不依赖 Electron 或保留的桌面渲染器：

```sh
npm run node:build
npm run node:init
```

接着按[服务端指南](docs/node-server.md)配置服务端模型和凭据，再运行
`npm run node:start`。在已完成初始化的桌面应用中打开 **设置 → 服务器**，添加
Node 地址，在系统浏览器登录并完成设备授权：第一台设备需要离线恢复码，后续
新设备需要已有可信管理员批准。详见[可信设备](docs/implementation/node-trusted-devices.md)。

获授权的远端 Bot 出现在原来的 Bot 列表和聊天区域中。管理员可以从
**+ → 新建 Bot** 选择部署服务器。远端 Bot 使用服务端的模型配置，不使用 Mac
上选择的模型 API。连接已有 Node 不要求客户端安装 Docker 或提供 SSH 凭据；
全新桌面配置的纯远端首次引导目前尚未完成。

## 架构与构建边界

```text
macOS 桌面 — 聊天、Bot 列表、设置
    ├─ 本机电脑 → coordinator + Host → 共用 Linux Docker 电脑
    └─ 设置 → 服务器 → 已授权 Node → Host + Bot 工作目录
```

| 源码位置 | 职责 |
| --- | --- |
| `source/electron-main/`、`source/electron-preload/` | 桌面生命周期、设置与可信 UI 桥 |
| `source/client-connections/`、`source/node/` | 服务器连接、设备授权和独立 Node 执行 |
| `source/host/`、`source/node-agent-coordinator/` | 模型推理、工具、聊天与本机协作 |
| `source/shared/` | 共享设置、协议和模型路由 |
| `frontend/` | 可读的 React/TypeScript 界面与共享组件 |
| `scripts/lib/` | 应用于实际打包渲染器的适配代码 |
| `tests/` | UI、运行时、安全、协作与打包回归 |

正式 UI 使用校验固定的上游渲染器，再应用可重建的 BeeBot 品牌、设置、聊天、
语言和头像适配。只修改可读的 `frontend/`，不能证明打包界面已经改变。
经过认证的上游输入保持不变，打包副本应用适配并接受校验。
详见[架构](docs/ARCHITECTURE.md)和[来源记录](PROVENANCE.md)。

## 开发与验证

使用固定工具链并遵循 [CONTRIBUTING.md](CONTRIBUTING.md)。安装依赖、准备运行时
并生成图标后，可以执行：

```sh
npm run check                            # 两套 TypeScript 检查与完整默认测试集
npm run frontend:build                   # 构建可读渲染器
node scripts/verify-native-window-layout.mjs # 真实 macOS 窗口与组件夹具
npm run package                          # 构建并签名桌面应用
npm run verify                           # 校验该应用包
npm run publication:check                # 验证已提交 Git 树的导出完整性
npm run node:test:integration             # 使用测试模型的真实 Node/Host/Shell 集成
```

默认测试集包含按条件跳过的部署和集成测试，跳过不代表通过。原生组件夹具和受控
模型测试也不代表真实模型的任务质量。

`npm run smoke` 另有纯源码渲染器来源与路由覆盖门槛。当前固定版渲染器构建尚未
满足该门槛，会报告 `PREREQUISITE`，不能视为原生冒烟通过。

生成的载荷和本机证据保存在被忽略的 `.cache`、`.build`、`dist`、`src/app/dist`、
`recovered`、`recovery` 等目录中。干净导出流程见[发布说明](docs/PUBLISHING.md)。

## 当前限制

- 桌面仍是实验性项目，面向固定的 macOS / Apple Silicon 运行时。仓库尚未交付
  Windows、iOS、Android 客户端或消息网关。
- 群聊目前使用本机 Bot。远端 Node v1 尚未共享本机协作记录，也未提供逐字流式
  输出等完整本机聊天能力。
- 多服务器连接不等于自动跨服务器分工、故障接替或成果迁移。连接成功不代表
  模型可用或任务完成；结果不明的中断操作不会盲目重放。
- 实验性托管 API 已有账号和加密空间存储；租户隔离执行、桌面空间切换及公开
  托管尚未完成。详见[托管 API 范围](docs/implementation/hosted-catalog-api.md)。

## 来源与许可

BeeBot 起步于对公开 Grok Bot 0.18.0 macOS 应用的非官方、面向源码的重建。
本项目独立于 Anysphere、Cursor、xAI 和 SpaceX，也不是官方 Grok Bot 发行版。

BeeBot 原创部分使用 MIT 许可。重建的上游材料、商标和保留的安装包不在该授权
范围内。详见 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md) 和
[PROVENANCE.md](PROVENANCE.md)。
