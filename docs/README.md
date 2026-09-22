> Historical design/research snapshot (September 16–17, 2026). Current behavior and merge decisions are defined by `AGENTS.md` and `docs/implementation/develop-consolidation-20260922.md`; this snapshot is not a current implementation promise.

# BeeBot 文档

本目录是交给开发 AI 与工程师的 BeeBot 改造文档。**先理解当前真实实现，再按明确契约改造；在现有仓库继续使用 TypeScript、React/Vite、Node.js，不删除项目重写。** 最新修订基于 2026-09-17 源码与构建链路核对。

最新范围：**只提供精致的 Web 客户端；服务与 Bot 执行端独立部署，通过网络连接；同一份代码的 Docker 交付物覆盖 Windows / macOS / Linux；每个 Bot 的执行器、私有记忆与专属持久电脑留在执行端；群内自主协作，无必选主管。** 同机安装只是便捷选项，独立远端与多节点协作属于首版。

| 文档 | 用途 |
| --- | --- |
| 1. [现有实现核对](./EXISTING_BEEBOT_IMPLEMENTATION_AUDIT.md) | 实际发布入口、Host/Runner/电脑、模型双路径、群循环、语言覆盖、持久化与验证边界 |
| 2. [开发技术栈与改造路线](./DEVELOPMENT_STRATEGY.md) | 已定语言/框架；哪些保留、替换、新增、退出；源码构建、迁移、旧代码删除条件与开发顺序 |
| 3. [产品与开发规格](./BEEBOT_SWARM_DESIGN_AND_DEVELOPMENT.md) | 蜂群产品/Web视觉、角色边界、数据模型、状态机、协议、工作包与A01–A50验收 |
| 4. [厂商与模型配置](./MODEL_PROVIDER_CONFIGURATION.md) | HTTP/CLI、URL/key/model、手填目录、每Bot绑定、真实测试、版本生效、凭据/历史迁移与M01–M12 |
| 5. [语言与设置](./LANGUAGE_AND_SETTINGS_DESIGN.md) | 设置导航、中英i18n、Bot/群输出语言、时区、偏好API、跨设备同步与L01–L17 |
| [服务与 Bot 独立部署设计](./DOCKER_DEPLOYMENT_DESIGN.md) | 两套部署描述、server/node/bot 镜像、三平台支持、数据归属、跨节点连接与恢复 |
| [现有模型路由审计](./research/2026-09-17-model-routing-audit.md) | 厂商保存、全局路由/每Bot差异、Codex direct与Claude工具桥的具体证据 |
| [现有语言与设置审计](./research/2026-09-17-language-settings-audit.md) | 默认发行renderer与React路径、设置存储和局部翻译的具体证据 |
| [现有 Bot 运行边界核对](./research/2026-09-16-beebot-runtime-boundaries.md) | 从源码核对 Host、Runner、私有状态与电脑的位置，区分现状和目标 |
| [现有架构](./ARCHITECTURE.md) | 原有仓库结构和实现背景，不代表新规格已实现 |
| [Grok Bot 研究笔记](./research/2026-09-16-official-grok-bot-group-design.md) | 官方理念与本机实现的参考事实 |
| [发布说明](./PUBLISHING.md) | 现有发布流程；新 server/node/bot 发布流程需随实现补齐 |
| [旧跨环境讨论稿说明](./design/2026-09-16-cross-environment-architecture.md) | 已被主规格替代，不再采用 Web + 桌面双客户端方向 |
| [旧 Group 讨论稿说明](./design/2026-09-16-group-collaboration.md) | 已被主规格替代，群协作契约以主规格为准 |

按表中1–5阅读后，再结合独立部署设计实施；这些正式规格共同生效，冲突先统一文档，不让不同AI自行选择不同字段或状态机。research与实现核对描述现状，设计规格描述目标，不能相互当作已经实现的证明。

首次可运行交付必须包含：独立Service → Web初始化账号/语言 → 保存厂商模型 → 注册远端节点 → 创建Bot/专属Runtime → Runtime真实模型和电脑工具 → Web持久结果。模型、语言、数据迁移不是最后再补的页面。

本次检查：现有 `npm run check` 类型与86项测试通过，`npm run frontend:build` 通过；没有据此宣称新Web、三平台Docker、CLI迁移或跨节点协作已实现。实施前阅读 [CONTRIBUTING.md](../CONTRIBUTING.md)，保护已有工作树修改，并随新代码提供对应验证证据。
