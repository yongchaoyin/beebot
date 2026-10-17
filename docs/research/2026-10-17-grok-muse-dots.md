# Grok Bot、Meta Muse、OpenAI dots：BeeBot 产品研究

研究日期：2026-10-17。BeeBot 代码基线：`ce1d8e0652d1f5bb00d2739d7a79388bb3a74ceb`，即本次 fetch 后的 `origin/main`。本文配套[产品方案](../design/2026-10-17-beebot-product-enrichment.md)与[实施及验收计划](../design/2026-10-17-beebot-product-enrichment-plan.md)。

## 1. 研究口径

本轮阅读三家的官方产品说明、更新日志、帮助文档、产品设计文章和安全架构说明，对照 BeeBot 当前源码与既有交付记录。Muse 设计文章中的状态、目标和确认界面图片也做了视觉查看。没有登录竞品账号完成真实任务，没有测量竞品成功率、延迟、耗电或成本，不把官方演示等同于亲测。

结论使用四种证据：官方文档描述的能力；官方已公布但仍在预告或分批开放的能力；BeeBot 源码中可追踪的实现；本轮提出、尚未实现的设计建议。文中的优先级是针对 BeeBot 的产品判断，不是竞品跑分排名。

本轮研究对象是 Grok Bot、Meta 的个人 Agent 产品 Muse、OpenAI 的 dots。Grok 普通问答、Muse 模型系列、其他同名 Dot 应用不混为同一个产品。日期以官方页面的发布、更新及访问日期分别记录；帮助中心当前正文优先于过时的搜索摘要。

## 2. 当前版本与能力边界

| 产品 | 本轮确认的公开状态 | 对判断有影响的边界 |
| --- | --- | --- |
| Grok Bot | 官方日志最新列为 2026-10-11 的 v0.70.2；新增 Bot 邮箱、聊天内应用卡片，并继续改进交付与审批体验。[G2] | BeeBot 上次吸收记录研究的是 0.66.0，当前包的固定渲染器基线仍是 0.18.0。这三个版本含义不同。 |
| Meta Muse | 官方设计文章介绍连续主聊天、分支聊天、可读记忆和长期目标；Connect 公布了语音及更多使用入口。[M2][M4] | 发布、演示及后续推出的能力需要分别验收。10 月 12 日发布、13 日更新的 Wonder 公告仍把 Muse 内接入写为即将推出、订阅用户优先。[M6] |
| OpenAI dots | 官方定位为持续工作的个人助手；当前帮助文档列出了用户发起通话、活动管理、本机执行和有限短信测试。[D1][D2] | 不能把未来多 dots 团队设想、企业试点，与普遍可用的长期多 Bot 群聊等同。当前文档仍列明主动来电、独立邮箱等限制。[D1][D2] |

## 3. Grok Bot：学习“同事把事情做完”的产品细节

Grok Bot 的官方产品介绍把长期 Bot、工作环境、协作和示范学习放在一起；Bot 可以沿用上下文继续工作。其共享电脑的描述按用户组织，不能推导为每个 Bot 都有独立安全沙箱。[G1]

最新日志值得关注的变化是：Bot 邮箱与待确认草稿、应用交互卡片、选中文本后加入聊天、默认观看再接管电脑，以及例行任务说明交付给谁。日志也明确修复了文件未送达、账号选择、失败状态等问题。[G2] 这些是官方记录，尚未通过本轮账号实测。

对 BeeBot 的启发是把每件工作的最后一步做完整：收件人是否正确，成果能否打开，用户能否继续修改，暂时失联时能否保留当前输入。新增一个按钮不等于这件事已经可用。

模板指南把模板作为可检查、可选择包含内容的工作配方，并提醒连接、依赖等仍可能需要配置。[G3] BeeBot 可以学习“从一份可用工作配方开始”，但新建时必须继续确认职责；不能因为导入模板就继承发布者的账号、私密记忆或执行授权。

工程指南展示长期 Bot 带着目标监督具体执行任务的用法。[G4] 对 BeeBot 更有用的是长期身份与临时任务的分工，而非复制示例中的固定负责人层级。工程示例中的规模数字不是本轮对比测试，不用于证明某家更可靠。

## 4. Muse：学习“理解生活与工作，并持续在场”

Muse 官方设计文章把连续主聊天、可展开的旁支事项、活动、记忆、目标和交互成果联系起来。状态图片先给出正在做的事情；目标图片区分正在关注的事项与长期目标；确认图片展示具体对象与动作。[M2]

由此得到的 BeeBot 设计判断是：用户不应为每条消息选择一次“聊天模式/任务模式”，也不需要每天从历史记录里重新拼出自己的事情。普通交流保持直接；真正需要持续推进的工作，才在会话旁边留下清楚的责任和去向。

长期上下文的价值还包括可纠正性。BeeBot 应让用户知道某条记忆从哪里来、适用于哪位 Bot 或哪个项目，能纠正和停止使用。把“记得很多”换成“用对、解释得清、改得动”，更适合长期信任。

Muse 的安全架构说明把执行环境和权限服务分开，具体动作经独立授权边界处理；Confidential VM 的表述包含后续开放安排，不能据此声称当前平台运营方已无法访问所有数据。[M3] BeeBot 应学习权限与执行分离，但不能把自己的共享目录、角色提示词或模型自检命名为同等级的隔离。

Connect 的语音与设备方向说明了“边说边做”的产品机会；眼镜等预告不应进入 BeeBot 近期承诺。[M4] Muse Small Business 也表明研究范围不能只限于生活陪伴，还应考虑实际业务工具与交付。[M5]

Wonder 公告提出 Active Memory、Active Focus，并说明 Muse 产品接入计划。[M6] 本轮不以名称推断内部算法，也不将模型发布等同于某个工作流已经稳定。BeeBot 可以把相关愿景转换成可测行为：遗漏背景是否减少、卡住后是否合理换路径、是否确实交付。

## 5. dots：学习“持续负责，以及用户随时接手”

dots 的发布说明强调个人上下文、持续工作、连接应用与独立执行环境；多 dots 协作和专家方向包含未来或试点内容。[D1] 因此适合学习长期责任、任务组织和用户介入，不宜据此判断它已经拥有 BeeBot 当前的同级持久 Bot Group。

当前帮助文档比发布时的信息更具体：手机应用可创建 dot；短信仍是有限测试；通话由用户发起。它也区分主会话和具体任务的上下文，切换执行电脑不会把既有任务自动搬过去。[D2]

对 BeeBot 的设计启发是明确“这句话在指挥哪件工作”。用户在主聊天补充要求、在任务旁支改范围、在手机确认一个动作，应能指向同一件事，同时不把所有会话历史无差别塞给所有执行者。

dots 官方安全说明为主动研究设置了代码层的只读限制。[D3] BeeBot 已有主动例行任务，但目前的“定时唤醒、遵守授权”与“只能观察、不能产生外部写入”的执行通道不是一回事。后者值得作为可控主动性的基础。

## 6. 对比之后的产品取舍

下表是针对 BeeBot 的设计判断，竞品依据见上文；不是对三家全部功能的穷尽列表。

| 用户要解决的问题 | 值得吸收的方向 | BeeBot 应保持的选择 |
| --- | --- | --- |
| 第一次打开不知道能做什么 | 从具体工作配方开始，按任务引导连接必要工具 | 不自动创建一堆 Bot，不伪造模型或服务器就绪 |
| 聊几天以后事情散落在各处 | 连续聊天加可追溯事项与成果 | 原会话是交流入口，结构化状态服务于交流 |
| 交代以后仍要不断催促 | 明确责任、持续关注、只有有效变化才来找用户 | 例行唤醒不等于新增授权；没有新信息允许沉默 |
| 对助手记住什么没有把握 | 记忆可查看、可纠正、可限定作用范围 | 私有、用户共享、项目共享不互相隐式复制 |
| 打字不方便但需要调整工作 | 实时语音交流与原任务连续 | 挂断通话与停止工作是不同操作 |
| 每次重复教同一套步骤 | 示范形成可审查、可试运行的技能 | 技能描述不等于已经验证的执行能力 |
| 收到报告后还要复制到别处重做 | 成果可打开、引用、修改、再次交付 | 不直接执行任意生成 HTML，不另造平行结果账本 |
| 离开电脑后就无法跟进 | 少量可靠的手机/消息渠道 | 同一 Bot 身份与权限；先做一个完整入口 |
| 想组建自己的团队 | 专业 Bot 独立可用，群内真实分工 | 不要求所有请求经过永久“总管 Bot” |

## 7. BeeBot 当前实现：已具备什么，还缺什么

以下基于源码与仓库交付记录，不把历史测试结果当作本轮重新运行结果。

| 能力 | 代码与文档证据 | 当前判断与增量 |
| --- | --- | --- |
| 单 Bot、Group、职责与交付 | [职责实现](../../source/host/extensions/transcript/bot-roles.ts)、[协作完成](../../source/host/extensions/transcript/collaboration-completion.ts)、[群调度](../../source/host/extensions/transcript/group-chat-orchestrator.ts) | 已有重要基础。优先改善用户识别当前事项、继续修改与恢复的体验。 |
| 成果资料库 | [Library 说明](../implementation/conversation-library.md)、[正式包适配器](../../scripts/lib/beebot-conversation-library.snippet.js) | 已有本地成功公开消息索引；不是跨 Node、带版本编辑的完整成果系统。 |
| 主动跟进 | [实现说明](../implementation/local-proactive-followup.md)、[本地定时器](../../source/host/extensions/automations/local-routine-scheduler.ts) | 已有显式开启、持久调度与防重复。增量是关注条件、可解释通知、只读观察和完整目的地。 |
| 长期与共享记忆 | [记忆存储](../../source/host/extensions/memory/memory-service.ts)、[接入说明](../implementation/shared-memory-wiring.md) | 已有增删、合成保护和共享注入。未核实到完整的用户侧来源、纠正与共享管理体验。 |
| 邮件与 Slack 草稿 | [真实交付实现](../../source/host/extensions/transcript/draft-delivery.ts)、[协议说明](../implementation/draft-delivery.md) | 已有审批及回执；邮件要求指定 MCP 合约，不能当作任意 Gmail/Outlook 已可直接发送。 |
| 语音 | [录音控制器](../../frontend/src/recovered/features/conversation/workspace/voice.tsx)、[转写服务](../../source/electron-main/account/cursor-transcribe.ts) | 发现录音转文字及上游转写依赖；未找到可独立交付的实时双向通话链路。 |
| 外部沟通渠道 | [渠道声明](../../source/shared/channels.ts)、[监听集成](../../source/host/extensions/automations/listener-integrations.ts) | Slack/Discord 声明仍有 coming-soon；另有 Slack/GitHub 监听基础。不能把 MCP 发消息当成完整收发 Bot 渠道。 |
| 示范学习 | [录制服务](../../source/host/extensions/teach-recording/teach-recording-service.ts)、[扩展接入](../../source/host/extensions/teach-recording/extension.ts) | 已有录制、专用桌面与学习工作流入口；真实“学会—试跑—复用”尚需端到端验证。 |
| 动作授权 | [草稿交付](../../source/host/extensions/transcript/draft-delivery.ts)、[Auto-review 接入](../../source/host/extensions/auto-review/extension.ts)、[分类器](../../source/host/extensions/auto-review/sand-backend-smart-mode-classifier-exec.ts) | 有现成保护，也有上游服务依赖；必须核查实际提供方，不能一概宣称已自主化。 |
| 远端 Node | [协议](../node-protocol.md)、[控制存储](../../source/node/control-store.ts)、[连接管理](../../source/client-connections/manager.ts) | 有持久任务和恢复；与本地协作及部分新产品功能尚不等价。 |

## 8. 本轮收敛

建议近期先交付一条完整的用户路径：交代工作、补充上下文、继续聊天、看到有效变化、做一次必要决定、拿到可继续加工的结果。以此检验语音、记忆、渠道和工具是否真能组合使用。

跨 Node Group 和自主渲染器仍是战略事项，但不宜成为所有日常体验改进的先决条件。先用共同的产品概念、清楚的能力声明和兼容适配减少本地/远端差异，再逐项迁移权威状态，避免在两套已有账本之外新建第三套。

不建议近期复制生成式视频头像、硬件生态、大而全公开市场、永久总管层级，或为了看起来全能而默认给所有 Bot 全部工具。BeeBot 更有价值的组合是自然交流、真实团队、自己的执行节点与可控长期工作。

## 9. 一手来源登记

所有来源访问于 2026-10-17。下列链接记录公开证据，不表示安装、调用或接入这些产品。

| 编号 | 来源 | 发布/更新信息 | 本文使用范围 |
| --- | --- | --- | --- |
| G1 | [Grok Bot 官方产品页][G1] | 持续更新页面 | 长期 Bot、工作环境、示范学习 |
| G2 | [Grok Bot 官方 Changelog][G2] | 顶部最新 2026-10-11，v0.70.2 | 最近正式公布的功能与修复 |
| G3 | [Templates for Grok Bot][G3] | 2026-09-08 | 工作配方及模板边界 |
| G4 | [Grok Bot for Engineering][G4] | 2026-09-10 | 长期同事与执行任务的关系 |
| M1 | [Introducing Muse][M1] | 2026-09-08 | 产品身份与发布背景 |
| M2 | [How We Designed Muse][M2] | 2026 年 9 月 | 聊天、状态、记忆、目标及官方界面图片 |
| M3 | [How We Built Safety Into Muse][M3] | 2026-09-08 | 授权与运行边界、后续保密计算安排 |
| M4 | [The Biggest News From Connect 2026][M4] | 2026-09-24 | 语音与设备方向；预告单列 |
| M5 | [Introducing Muse Small Business][M5] | 2026-09-29，页面更新 2026-10-08 | 业务使用范围 |
| M6 | [Introducing Muse Wonder and Muse Wonder Full][M6] | 2026-10-12，更新 2026-10-13 | 模型发布与 Muse 接入的时间区别 |
| D1 | [Introducing dots][D1] | 2026-09-29 | 产品定位、未来团队方向 |
| D2 | [Getting started with your dot][D2] | 滚动更新帮助文档 | 当前使用方式及限制，优先于旧摘要 |
| D3 | [How we build safety, security, and privacy into dots][D3] | 2026-09-29 | 只读主动研究及用户控制 |

[G1]: https://x.ai/bot
[G2]: https://x.ai/changelog/bot
[G3]: https://x.ai/bot/guides/templates-for-grok-bot
[G4]: https://x.ai/bot/guides/grok-bot-for-engineering
[M1]: https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/
[M2]: https://introducing.muse.ai/
[M3]: https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse
[M4]: https://about.fb.com/news/2026/09/the-biggest-news-from-connect-2026/
[M5]: https://about.fb.com/news/2026/09/introducing-muse-small-business/
[M6]: https://about.fb.com/news/2026/10/introducing-muse-wonder-models/
[D1]: https://openai.com/index/introducing-dots/
[D2]: https://help.openai.com/en/articles/20001530-getting-started-with-your-dot
[D3]: https://openai.com/index/how-we-build-safety-security-and-privacy-into-dots/
