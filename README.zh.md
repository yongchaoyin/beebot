# Botfly

[English](README.md) | 中文

Botfly 是一个跑在 macOS 上的本地电脑 Agent。每个 Bot 都有自己的 Linux 电脑
（终端、文件、浏览器、桌面），并使用你为它选择的模型厂商。不需要 Cursor
账号，也不绑定 Cursor 云端。

本仓库与 Anysphere、Cursor、xAI、SpaceX 无关，也不是官方 Grok Bot 发行版。

## 当前功能

### 本地电脑

每个 Agent 都对应一台沙箱电脑。**设置 → Router → Use local Docker VM**
会把这台电脑跑在本机 Docker 容器里（只监听 loopback，设置和 API key
以绑定挂载方式注入）。需要 Docker Desktop，或其他兼容的本地 Docker。

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

Botfly 起步于对公开 Grok Bot 0.18.0 macOS 应用的非官方、面向源码的重建。
Electron、host、coordinator、本地执行和协议边界的可读 TypeScript 在
`source/` 下。打包后的应用仍以校验和钉死的 0.18 渲染器为 UI 基线，再叠一层
设置页和新建 Bot 的补丁。

Dock 名称和 bundle 标识是 Botfly。界面里仍有部分文案写着 Grok Bot，因为那份
官方渲染器是按字节保留的。

Botfly 原创部分使用 MIT 许可。重建得到的上游材料和保留的 0.18.0 安装包不在
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
git clone https://github.com/yongchaoyin/botfly.git
cd botfly
git lfs install
git lfs pull
npm ci
npm run bootstrap
npm run check
npm run package
open dist/Botfly.app
```

1. 在首次配置页粘贴厂商 API key（之后也可以在 **设置 → Router → 模型 API**
   里继续添加）。
2. 如未打开，打开 **Use local Docker VM**。
3. 新建 Bot，选好它使用的 API，然后发一条消息。

`npm run bootstrap` 会优先使用 Git LFS 里保存的 0.18.0 DMG。若本地没有这份
归档，再回退到原来的公开下载地址；也可以用 `GROK_BOT_018_APP` 指向已有的
应用副本。Bootstrap 会校验 DMG 和 `app.asar`，缓存对应的 Electron 运行时，
并填充被忽略的 `src/app/dist` 构建输入。

`npm run package` 会编译运行时、打上渲染器补丁、生成应用包、写入 Botfly
bundle 标识、做 ad-hoc 签名并校验。产物在 `dist/Botfly.app`。

打包构建会在打包边界关掉上游更新器，并默认关闭上游 Sentry 和遥测。显式提供
的环境配置仍然生效。

## 架构

```text
官方渲染器 + Botfly 补丁
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
              这个 Bot 自己的 Linux 电脑
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

应用可以启动，核心流程可用：本地 Docker 电脑、多个模型 API、按 Bot 选厂商。
目前仍是实验性项目，只针对钉死的一份 macOS/arm64 运行时，不承诺兼容后续官方
Grok Bot 版本。飞书、QQ 这类消息网关还在规划中，尚未进仓库。

改代码请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。干净历史导出流程见
[docs/PUBLISHING.md](docs/PUBLISHING.md)。
