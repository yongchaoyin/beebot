# BeeBot Web 语言与设置开发设计

状态：开发契约；以 2026-09-17 当前仓库审计为依据。只开发 Web 客户端，复用 TypeScript、React、Vite 与可读服务实现。

配套文档：[主规格](./BEEBOT_SWARM_DESIGN_AND_DEVELOPMENT.md)、[现有实现审计](./research/2026-09-17-language-settings-audit.md)。主规格负责身份、workspace、模型、节点、电脑、协作、授权与事件；本文只补充语言/个人偏好/设置导航，不复制这些实体的第二套状态机。旧实现与本文目标不得混写为已经完成的功能。

## 1. 首版明确决策

1. 界面支持“自动 / 简体中文 / English”；新账号默认自动。自动读取当前浏览器语言，不读取执行节点或服务器操作系统语言。
2. 账号保存的是语言偏好 `auto | zh-CN | en`；`auto` 的实际显示语言由每台设备决定，所以两台设备可以有不同界面语言。
3. 同一 Service 身份的偏好跨设备同步。本机 Service 与另一台服务器是两个 authority，首版不提供跨 authority 账号或偏好同步。
4. 界面语言、Bot 私聊回复语言、群工作交付语言、显示时区、工作时区分开；不通过切换 UI 修改 Bot 身份、历史消息或历史成果。
5. 个人外观偏好保存成功后立即生效；Bot/群工作偏好只作用于后续工作，已经开始的工作使用接受时的快照。
6. 不保留一个同时控制 UI、模型回复、时间与任务运行地点的“系统语言”总开关。
7. 设置页面展示真实可用能力；不创建没有路由、保存行为或恢复入口的空导航。

## 2. 从当前实现迁移的边界

当前只有 `en/zh`、默认 en 的本机 JSON 偏好和局部中英 copy；实际发行使用 renderer 补丁，React 重建是另一条代码路径。该结论及具体源码证据见审计，不以 `frontend/README.md` 的过时默认构建说明为依据。

迁移器读取旧 `uiLanguage` 时，`zh → zh-CN`、`en → en`；只有旧字段确实缺失才选择 `auto`，不能将旧 getter 补出的 en 当成用户显式选择。未知值记录迁移 warning，并采用 auto。

旧值仅在目标个人偏好记录不存在时导入一次，记录 migration ID。重新导入或另一台机器连接不得覆盖已保存偏好。旧配置、MCP 规则与厂商秘密按主规格迁移并保留回退材料，浏览器不直接读取旧文件。

新 UI 不再使用 `window.__sandUiLanguage`、`sand-ui-language-changed`、DOM 查找替换来翻译。默认打包补丁不继续扩写为 Web i18n；迁移后从 React 源码构建同一 Web 应用。

## 3. 语言与时区的职责和优先级

### 3.1 界面语言

解析顺序为：已登录账号 preference → 登录前本浏览器明确选择 → auto。只在账号尚未初始化偏好时允许浏览器选择作为创建初值；账号已有偏好时以服务端值为准。

auto 扫描 `navigator.languages`：首个 `zh` 语言标签匹配简体资源，首个 `en` 标签匹配英文资源，其他标签继续扫描，均无匹配时为 en。zh-Hant/zh-TW 首版同样显示简体，并在选择器明确列出“简体中文”，不宣称提供繁体。浏览器没有该 API 时回退 en。

运行中监听浏览器 `languagechange`；仅在 preference=auto 时重新解析。显式 zh-CN/en 不随浏览器改变。设置项显示“自动（当前：简体中文）/ Automatic (currently: English)”以免用户误解。

`document.documentElement.lang` 随 resolved locale 更新。语言切换保留路由、输入草稿、滚动位置、焦点、附件与电脑观看会话；无需刷新页面或重连 Bot。

### 3.2 Bot 私聊回复语言

Bot 详情的“回复语言”首版取值为 `auto | zh-CN | en`，默认 auto，归 Bot 本身，供其私聊使用。

优先级：当前用户明确提出的语言要求 → Bot 显式回复语言 → 当前用户消息的主要自然语言 → 该私聊最近一次已确定的输出语言 → 发起者当次解析出的界面语言。

auto 是跟随对话，不是永远跟随 UI。代码、URL、附件文件名、引用块和 Bot 自己的历史输出不作为“用户主要语言”的首要证据。语言不明确时采用最后两项，不为问候或纯附件反复追问。

用户可以用自然语言请求其他输出语言；首版 UI 只提供中英偏好不限制模型理解其他语言。模型按当前任务遵循要求，协议只记录规范化 BCP 47 tag 或保留明确的语言要求，不把“UI 仅中英”当内容过滤规则。

### 3.3 Group 工作交付语言

Group 详情有“工作与交付语言”，首版取值 `auto | zh-CN | en`，默认 auto。创建 Group 时折叠在可选设置内，不增加必填项；也不产生负责人字段。

优先级：Boss 对本次工作的明确语言要求 → Group 显式工作语言 → 本次目标消息的主要自然语言 → 发起者当次解析出的界面语言。

群工作使用同一 Run 的语言上下文，不再分别应用各 Bot 的私聊语言偏好。这样一个默认中文的 Bot 与默认英文的 Bot 可以共同完成英文群任务。内部工具/代码/API payload 保持所需格式，公开进展和交付说明遵循 Run 语言。

语言结果随 Run 接受目标一起形成可审计快照；派发到实际 BotRuntime。不得每轮按当前在线浏览器重新计算，也不因成员更换而变化。普通群消息仍遵守主规格的寻址与自主参与规则，语言不改变谁被唤醒。

语言解析不引入 Service 模型或隐藏主管。Service 按显式表单、配置和确定性文本规则生成初始上下文；文本规则只在证据明确时判中英，纯代码/附件/混合不明确时按上述优先级回退。自然语言中更复杂的明确要求由已有成员 attention 识别，通过 `propose_output_language` 提交原用户消息 ID、原文范围与结果；Service 校验作者、范围、当前 dispatch 和版本，不接受 Bot 发言或附件文字冒充 Boss 要求。

新 Run 的语言上下文随初始 attention 屏障一起封存，再开放 work；Run 已被首个提案创建时，屏障前的值仍是 provisional。相同提案去重；不同解释仅定向澄清一次，仍冲突则保留确切用户要求、outputLocale=null，由成员遵循原要求，不随机选先到者的语言。私聊在自己的 Runner 内按同一规则识别，若需覆盖初始上下文，先提交同一命令并获得权威回执再执行；使用原 attempt 预算，不新增必运行的语言判断模型。显式表单值优先，普通回复无需为了语言再跑一次模型。

在运行中更改群默认语言只影响下一次工作。Boss 明确说“这次改用英文”属于主规格的目标修订，更新目标/语言快照并使相关旧执行失效；不把普通设置保存伪装成目标修订。

消息被路由为补充现有Run时，默认沿用该Run已封存上下文；新消息的主要语言或发起端UI不同不能自动覆盖它。只有当前Boss的明确语言变更走目标修订；attention提案不得直接改写正在执行的Run。纯讨论没有Run时，语言上下文只归本次dispatch，不新建任务。

### 3.4 时间与日期

显示时区是个人偏好：auto 使用当前浏览器 IANA 时区，显式值使用所选 IANA 时区。浏览器获取失败时显示 UTC，并给出可修正的轻提示。

工作时区属于 workspace，影响新任务对“今天/明早/本周”的理解。首次初始化时由 owner 确认浏览器检测值，无法检测则明确使用 UTC；保存后不随访问设备变化。

Run 接受时固定工作时区；Routine 使用自己的已保存时区。修改工作默认不重排已有 Routine、不修改已提交工作的截止时间。涉及重排必须通过对应任务/自动化编辑流程明确展示变化。

存储时间沿用主规格的服务端 UTC 毫秒；展示使用 `Intl.DateTimeFormat(resolvedUiLocale, {timeZone: resolvedDisplayTimeZone, ...})`。数字、相对时间使用对应 Intl API。日期呈现随 UI locale，执行时间不随 UI locale。

## 4. 设置项的默认、归属与生效时间

第一版服务支持单 owner；表中 owner 指通过当前 authority 身份校验的 owner。未来多用户权限只扩展现有授权机制，不改变偏好语义。

| 设置 | 默认 | 持久层/作用域 | 可编辑人 | 生效 |
| --- | --- | --- | --- | --- |
| 界面语言 | auto | Service 个人偏好；登录前浏览器缓存 | 当前用户本人 | 保存成功后当前及同账号其他设备立即生效 |
| 主题 | system | Service 个人偏好 | 当前用户本人 | 即时；system 在各设备独立解析 |
| 显示时区 | auto | Service 个人偏好 | 当前用户本人 | 即时重排版，不改数据 |
| 默认 Bot 私聊回复语言 | 不设账号级总开关 | 每 Bot 显式值；新建 auto | owner | 下次接受的用户回合 |
| Group 工作语言 | auto | Group 可见配置 | owner | 下个 Run；当前修改须走目标修订 |
| 工作时区 | setup 确认检测值，否则 UTC | workspace 设置 | owner | 新 Run/新 Routine 的初值 |
| 新 Bot 默认模型 | 未配置 | 主规格 model-defaults | owner | 仅新建 Bot，不改已有 Bot |
| Bot 模型/电脑位置 | 创建时选定 | 主规格 Bot/Provider/Node/Computer | owner | 按主规格配置/运行边界，禁止页面私改 |
| 页面减弱动效 | 跟随 prefers-reduced-motion | 当前浏览器环境 | 操作系统/浏览器用户 | 即时；首版不增加重复开关 |
| 页内消息与需处理事项 | 开启 | 消息/决策事实，非系统推送偏好 | 不可关闭事实记录 | 即时 |
| 浏览器系统通知 | 首版不承诺/不开权限弹窗 | 无新持久字段 | 不提供假开关 | 后续有 Web Push 闭环后独立设计 |

用户已输入的名称、职责、MCP 指令、消息、文件名和记忆不是翻译资源。修改设置不翻译或替换它们。语言偏好本身不属于 Bot 人格记忆，不能由记忆总结反向覆盖配置。

## 5. Web 设置导航与已有功能去向

桌面浏览器使用左侧窄导航与右侧表单；窄屏使用“设置分类 → 单页详情 → 返回”。设置入口固定在主导航底部，页面保持当前会话草稿。Bot 与群的专属配置放在对象详情，设置中心只提供明确跳转。

| 分类 | 首版可交付内容 | 旧能力处理 | 首版不出现的伪入口 |
| --- | --- | --- | --- |
| 通用 | UI语言、主题、显示时区；单独区域展示/修改工作时区 | 保留语义，替换本机JSON和DesktopBridge为个人/workspace API | 操作系统区域设置、全局热键编辑 |
| 模型 | 厂商增删改、凭据状态、连接测试、模型选择、新Bot默认 | 复用现有厂商校验与路由；使用主规格§8.7 API | 空白“即将支持”厂商卡、未经验证的可用状态 |
| 执行节点 | 列表/能力/容量/健康、登记、撤销及受影响Bot | 替换旧remote/local-docker全局开关；按节点管理 | 浏览器直接启动宿主Docker、本机CLI自动发现 |
| 电脑 | 按Bot列出专属电脑、状态、存储与节点、打开观看/接管 | 使用主规格真实电脑协议；重要操作回到电脑详情 | 一个全局“重建电脑”同时影响所有Bot |
| 安全 | 当前登录身份/会话、退出/撤销会话、隔离与审批策略说明、待处理决策跳转 | 身份改为BeeBot Service；旧本机执行/MCP规则按下表处理 | 把旧WebAuthn硬件代理作为Web通用开关 |
| 数据与诊断 | 版本、数据/备份状态、迁移记录、可下载脱敏诊断 | 复用主规格运行管理与迁移结果；服务返回真实状态 | 未实现的一键云备份、无操作端点的“导出全部” |

“数据与诊断”首版允许状态只读，但必须有真实数据和清晰说明；读不到显示失败和重试，不填演示数字。没有备份设施时写“未配置备份”，不画已保护勾号。诊断下载不得包含密钥、cookie、私聊正文、浏览器profile或私有记忆。

以下旧设置逐项处理，不能在 Web 改造时静默消失或冒充支持：

| 旧能力 | Web 首版处理 |
| --- | --- |
| theme/uiLanguage/timeZone | 保留并按本文拆分；旧 detected timezone 不能覆盖新账号每台设备显示偏好 |
| inferenceVendors/default/model/computerUseModel | 模型配置进入主规格Provider和Bot模型策略；不再维护第二个Router总开关 |
| MCP custom instructions/disabled tools | 保留并迁移到对应BotRuntime的工具配置；已有编辑功能可从Bot详情进入，能力尚未迁移时只读展示原配置和原因，不写入无效值 |
| Auto-review allow/block instructions | 保留旧规则用于迁移审查；作用域必须标明Bot/工具；实现新执行授权前只读，不能用UI开关跳过主规格UserDecision或宿主隔离 |
| localToolPermission/ceiling | 不映射为“允许浏览器访问整台电脑”；专属电脑内部执行与宿主越界分开，按主规格安全契约替代 |
| Cursor登录、Cursor订阅/付款/企业usage | 不作为BeeBot Service登录或首用前提；首版移除云订阅入口；真实provider用量可只读显示且注明估算/缺失 |
| local Codex/Claude账号 | 属于实际Bot电脑/执行环境的CLI能力；显示节点与登录状态，从电脑内登录；不读访问者桌面账号 |
| remote/local-docker开关 | 替换为节点与每BotRuntime配置；旧选择只用于迁移来源标记 |
| 更新频道、空闲自动升级、重启更新 | 不迁移到Web个人设置；版本在诊断只读，Service/Node升级按部署流程执行 |
| 桌面egress隧道 | 不宣称浏览器可替代；后续节点网络能力若实现，使用独立受授权节点配置 |
| 硬件安全密钥代理 | 现有Electron代理不移植为普通网页功能；Web登录自身WebAuthn与远端网站借用本机密钥是不同功能 |
| 原生通知/全局快捷键 | 不迁移为同名可用开关；首版仅页内通知与页面聚焦时键盘操作，不声称后台/浏览器关闭后仍通知 |
| sidebar/pins/onboarding | 作为应用状态迁移；不挤进通用设置表单，不重置老用户导航 |

后续未实现功能不显示可点击导航或不可保存表单。因当前部署缺能力的既有对象保留信息与原因，例如离线节点上的电脑仍可查看归属和最后状态，操作按钮清楚说明恢复条件。

## 6. 精致且一致的中英设置界面

沿用主规格第3节蜂蜜琥珀点缀、克制中性色与 light/dark tokens，不单做另一套设置视觉系统。右侧表单建议宽度 640–760px，逐行显示标题/说明/控件，不做一屏等尺寸卡片看板。

语言选择器三个选项始终使用“自动 / 简体中文 / English”可辨认名称，用户即使误选也能改回。当前模式旁显示解析结果，不使用国旗代表语言。

每项标签与说明各负其责：例如“界面语言”下写“只改变 BeeBot 的菜单和按钮。”；“群工作语言”下写“用于下一次工作的进展和交付。”；运行中修改显示“当前工作继续使用中文”。

即时设置保存提供“保存中 → 已保存/保存失败”，失败保留用户选择草稿但恢复有效状态，不显示伪成功。需要测试或多字段校验的模型表单使用显式保存按钮，避免逐字发请求。

加载时保留布局和表单标签，以控件骨架表示未知值；离线显示最后确认值及时间，禁用服务端修改。失败提供局部重试，不把整个会话页面清空。连接恢复先拉最新版本再允许提交草稿。

中文字体沿用主规格中文回退链，正文建议14px/1.6，说明文字不小于12px，控件最小44px触控区域；英文长标签正常换行，不用定高截断。不得把中英文靠拼接实现“已保存{名词}”等语序。

语言切换的文案重排不播放大位移动画，轻量颜色/透明度过渡遵守 reduced motion。键盘 Tab 顺序自然、焦点可见，选择器符合 combobox/listbox 语义；保存结果以 aria-live=polite 宣告，验证错误与输入关联。

页面快捷键仅在文档有焦点且不与输入/IME冲突时处理；避免覆盖浏览器地址栏、刷新、查找等原生快捷键。中文拼音 composition 中按 Enter 不能保存表单或发送消息。

## 7. i18n 资源与前端服务边界

保留同仓 TypeScript/React/Vite。建议新增下列源码边界，可按主规格最终目录布局调整名称，职责必须保持：

```text
frontend/src/i18n/config.ts                 locale解析、类型、fallback
frontend/src/i18n/provider.tsx              一个全应用Provider，设置html.lang
frontend/src/i18n/locales/zh-CN/*.json       按domain分文件
frontend/src/i18n/locales/en/*.json
frontend/src/i18n/format.ts                 Date/Number/RelativeTime集中格式化
frontend/src/services/preferences-client.ts  typed HTTP，不引用Electron
frontend/src/features/settings/             导航、通用设置、保存/冲突状态
source/shared/contracts/preferences.ts      请求/响应运行时schema和TS类型
```

资源 namespace 使用 `common/settings/conversation/bots/groups/computer/errors`；key 采用语义名称如 `settings.general.uiLanguage.label`，不使用中文原句或数组位置作key。两种语言键集合在构建检查中完全对应。

采用 `i18next + react-i18next`，使用 i18next JSON v4 的插值/复数格式，时间数字使用 Intl；新增依赖在 P0 固定到锁文件，不同时混用 ICU 和另一套自制翻译协议。带链接文案用受控 `Trans` 组件插值，禁止翻译资源注入任意HTML；用户内容原样按安全Markdown规则渲染。[React 绑定](https://react.i18next.com/)、[JSON 资源格式](https://www.i18next.com/misc/json-format)

首版资源随静态包提供，避免切语言再次依赖网络。开发时缺key直接告警并可见，CI失败；生产兜底到英文且记录缺key，不能向用户展示内部key。

错误协议沿用主规格 `{code,message,retryable,details?,requestId}`；前端按code映射本地化主文案，details只插入允许的结构字段。服务端message用于诊断，不用英文字符串匹配业务分支。未知错误显示通用说明+requestId，不回显密钥或栈。

系统生成的历史事件应保存类型和参数，由查看者locale呈现；用户/Bot已经发送的消息与成果保留原语言。群里的同一Bot回复不会因两位查看者UI语言不同而分别重写。

`DesktopBridge` 只作为旧实现迁移参照。Web组件使用 PreferencesClient、主规格 ApiClient/事件store；不创建desktop adapter，不访问window.desktop、不在浏览器尝试读取settings.json。

## 8. API 与最小数据增量

本节新增个人偏好与语言字段的唯一schema来源；模型/节点/电脑继续使用主规格定义。落地时把这些增量同步到主共享契约，不并存两份同义字段。

```ts
type UiLocalePreference = "auto" | "zh-CN" | "en";
type ResolvedUiLocale = "zh-CN" | "en";
type OutputLanguagePreference = "auto" | "zh-CN" | "en";
type ThemePreference = "system" | "light" | "dark";
// Runtime schema: "auto"，或通过IANA校验的时区；不是任意字符串。
type DisplayTimeZonePreference = string;

interface PersonalPreferences {
  uiLocale: UiLocalePreference;
  theme: ThemePreference;
  displayTimeZone: DisplayTimeZonePreference;
}
interface PersonalPreferencesView {
  preferences: PersonalPreferences;
  revision: number;
  updatedAt: number;
  eventCursor: string; // 与快照同事务读取，用于无遗漏接续SSE。
}
interface UpdatePersonalPreferences {
  expectedRevision: number;
  patch: Partial<PersonalPreferences>;
}
```

所有请求严格schema校验；未知字段/无效locale/无效时区返回 `INVALID_INPUT`。HTTP层不沿用旧parse函数将所有非法输入静默转英文。GET总返回完整默认值，不要求客户端猜undefined。

| 端点或现有实体增量 | 契约 |
| --- | --- |
| GET `/api/v1/me/preferences` | 认证后获取本人的完整PersonalPreferencesView，含同事务eventCursor；不得传任意userId读他人偏好 |
| PATCH `/api/v1/me/preferences` | 上述partial patch+expectedRevision；使用主规格Idempotency-Key；成功返回完整新snapshot |
| POST `/api/v1/auth/setup` 增量 | 可接收明确的 initialPreferences；只在首次创建owner/偏好记录时写入 |
| GET/PATCH `/api/v1/workspaces/{w}/settings/regional` | `{workTimeZone, revision}`；PATCH需要expectedRevision和有效IANA值；仅owner |
| Bot 现有创建/更新/详情 | 增加 `replyLanguage`；默认auto；沿用Bot expectedRevision |
| Group 现有创建/更新/详情 | 增加 `workLanguage`；默认auto；沿用Group expectedRevision |
| Run/私聊回合的上下文快照 | 增加 `languageContext`，按第3节由Service接受、封存并发给Runtime；普通客户端不得伪造来源 |
| GET `/api/v1/auth/sessions` | 当前用户会话列表，只回显示所需的时间/设备概况与当前标记，不回cookie/token |
| DELETE `/api/v1/auth/sessions/{id}` | 当前用户撤销自己的会话；可撤销当前会话，成功后退出；跨身份返回FORBIDDEN |
| GET `/api/v1/workspaces/{w}/settings/overview` | owner只读查看下述版本、备份、迁移和策略概况；从已有权威状态投影，不另存第二份配置 |
| GET `/api/v1/workspaces/{w}/settings/diagnostics` | owner下载白名单字段构成的脱敏JSON诊断；不打包原始日志、配置文件或Runtime私有目录 |

`/me/preferences` 属于当前 authority 的身份偏好，是主规格“业务实体属于workspace”的明确身份级例外；首版不引入外部云账户同步。权限、CSRF、TLS、cookie和requestId规则与主API完全相同。

`languageContext` 保存 `{outputLocale, explicitInstruction, source, sourceRevision?, workTimeZone, resolvedAt}`。`outputLocale` 为规范化BCP47值或null；`explicitInstruction`为本次明确语言要求或null，二者不能同时null。只有明确要求无法规范化时才允许locale=null，Runtime使用原要求；不得伪造一个locale。source枚举 `explicit_request | group_preference | bot_preference | user_message | conversation_context | initiator_ui`，按私聊/群流程限制可用来源。

`settings/overview` 返回 `{serviceVersion, schemaVersion, backup, migrations, effectivePolicies}`：backup为 `{scope: "service_metadata", state: "not_configured" | "ready" | "failed" | "unknown", lastSuccessfulAt: number | null}`；migrations为 `{id, completedAt, warningCodes}[]`；effectivePolicies为 `{code, source, editable: false}[]`，只描述当前实际生效边界。页面必须标明这是服务元数据备份，不能据此声称Bot磁盘/profile/记忆已备份；私有卷保护状态需真实节点上报。诊断JSON只包含以上字段、脱敏节点/电脑状态计数、生成时间与requestId；没有采集能力时返回unknown，不能猜测成功。

发起消息可带当前解析的 `initiatorUiLocale: "zh-CN" | "en"` 作为末级回退提示，以及用户明确设置的可选 `outputLocale`（规范化BCP47值）作为当次要求；服务不把UI提示当权限或显式交付要求。API集成未给UI提示时，使用账号显式locale，否则en。自然语言提案与resolved上下文持久化位于第3节的接受/attention流程；不得在Service调用模型，也不在后续每个work重新判断。

已确定的languageContext在任务上下文里传给Runtime，模型提示解释它只控制自然语言，不覆盖代码/工具协议/安全规则。历史补录时没有原始语言快照则标记legacy，不根据现在的UI设置改写历史。

## 9. 持久化、跨设备冲突与事件

Service的个人偏好记录按principalId隔离，带revision；workspace区域设置独立记录。变更事务写新值、revision和outbox事件。个人偏好不能放进provider secret store，也不能把浏览器缓存作为账号权威。

登录前浏览器缓存只存 `uiLocale/theme` 等低敏感外观值，不存令牌、厂商key或Bot内容。按Service origin/schema version命名；登录后可缓存已确认偏好用于首屏，但标记账号与revision，账号切换立即丢弃上一账号快照。

服务器已有偏好时，登录前的缓存不会自动PATCH覆盖它。首次setup可用当前浏览器明确选择初始化。退出后保留独立的登录前外观缓存，清除账号缓存和私有状态，避免共享浏览器泄漏上个用户偏好。

修改采用CAS：revision一致才写；成功后应用响应。收到 `REVISION_CONFLICT` 拉最新snapshot，展示“设置已在另一台设备更新”，保留本地未提交选择；用户明确“采用我的选择”后以最新revision重试，不盲目最后写入覆盖。

自动保存控件一次仅有一个在途提交，连续切换合并为最新待提交值；旧响应不得覆盖新草稿。语言预览可本地即时出现，但必须标识保存中，失败恢复确认值并保留重试入口。UI有效状态以已确认revision为准。

事件沿用主规格SSE，不为设置再引入WebSocket。新增 `preferences.updated` 与 `workspace.regional_settings_updated`，aggregateRevision分别使用对应设置revision；Bot/Group语言修改沿用其已有实体更新事件。

`preferences.updated` 仅投递给同一principal的已认证会话，payload包含新snapshot或可重取的revision，不含密钥。首版单owner/workspace可复用workspace SSE的全局订阅；会话过滤不能遗漏个人偏好事件。未来多用户仍必须服务端按接收人过滤，禁止向整个workspace广播个人设置。

前端应用主规格的eventId去重、版本检查、cursor恢复；断线恢复后校验个人snapshot，不能仅听“之后更新”。收到另设备更新且本地无草稿时立即应用；有草稿时展示冲突，不默默丢弃编辑。设置同步不改变各设备焦点、草稿与电脑接管状态。

Web登录后先读取偏好snapshot及其cursor并建立workspace全局SSE，再加载各会话snapshot；未完成初始加载的实体事件先缓冲，按revision应用。不得先读偏好、再用更晚的会话cursor跳过中间事件。切换会话不重建全局设置订阅；CURSOR_EXPIRED时重新走此初始化顺序，不能比较或拼接opaque cursor。

电脑流使用主规格既定实时通道；本文事件设计不修改电脑WebSocket/控制租约协议。

## 10. 开发顺序与源文件改造地图

1. 先合入共享schema、偏好数据库迁移、API、授权与CAS，再实现事件；此步不改Bot运行行为。
2. 加全应用i18n provider与中英资源，把所有首版主路径的硬编码文案迁入资源；从设置、首用、会话、电脑控制、错误和空状态开始。
3. 实现设置导航、个人偏好与跨设备同步，彻底移除新Web构建对DesktopBridge语言API的依赖。
4. 实现Bot/Group语言字段、接受时的languageContext及Runtime提示，覆盖运行中修改与历史保留。
5. 按功能去向表连接已有模型、节点、电脑和安全页面；读取旧数据进行一次迁移，展示缺能力/迁移记录。
6. 最后执行浏览器行为与视觉验收；不能只以现有ui-language两条helper测试验收。

| 当前文件/边界 | 改造方向 |
| --- | --- |
| `source/shared/ui-language.ts` | 保留旧迁移parse语义于legacy边界；新UI strict schema与locale resolution另建，避免污染旧reader |
| `source/shared/node/settings/sand-settings-store.ts` | 作为旧配置导入来源；新偏好进入Service数据库，不让两者双写竞争 |
| `source/host/extensions/settings/settings-service.ts` | 拆明工作设置与UI偏好；UI字段不进入每BotRuntime全局旧HostSettings |
| `frontend/src/production/ProductionRenderer.tsx` | 以统一i18n/context替换根局部语言状态，保持主会话状态稳定 |
| `frontend/src/recovered/features/settings/overlay/*` | 提取表单/校验可复用逻辑，重接Web客户端；去除桌面更新、Cursor账单与不适用代理开关 |
| `scripts/lib/router-renderer-patch.mjs` 与 `sand-*.snippet.js` | 仅作为旧发布UI行为参照；新Web不继续注入翻译补丁 |
| `source/electron-preload/preload.ts`、`main-edge.ts` | 记录旧迁移映射，不作为新Web调用链，也不新建桌面发布 |
| `tests/ui-language.test.mjs` | 保留旧行为回归；新增测试应覆盖新schema、优先级、迁移及真实浏览器状态 |

## 11. 首版验收用例

| ID | 场景 | 必须结果 |
| --- | --- | --- |
| L01 | 空数据库+中文浏览器首次setup | 默认auto，界面中文；完成模型配置/建Bot/首条回复全流程，无英语占位错误 |
| L02 | 空数据库+不支持的浏览器语言 | 回退en；可找到并切换简体中文 |
| L03 | 手动英文+中文浏览器 | 保持英文；刷新/重新登录仍英文 |
| L04 | 同账号两设备选择auto | 两端保存同一auto值，各自按浏览器解析，不争抢“最终locale” |
| L05 | A改显式中文，B在线 | B通过SSE切中文；不丢草稿/焦点，不关闭电脑观看 |
| L06 | A/B并发保存同revision | 一个成功，一个REVISION_CONFLICT；不得静默覆盖 |
| L07 | 保存失败/离线/401 | 不伪成功、不排队隐式修改服务；可重试或登录后恢复草稿 |
| L08 | 新账号与旧JSON迁移 | 缺字段auto、显式en仍en、zh转zh-CN；第二次导入不覆盖新偏好 |
| L09 | 中文UI下要求英文回复 | Bot按本次英文要求；UI仍中文；历史不变化 |
| L10 | 两个不同Bot回复偏好加入英文群工作 | 公开进展和交付遵循同一英文Run上下文；私聊各自偏好保持 |
| L11 | 运行中只改群默认语言 | 当前Run不变，下个Run使用新默认 |
| L12 | Boss明确要求当前工作改语言 | 走目标修订和旧attempt失效流程，有可追踪的revision |
| L13 | 设备从上海时区改纽约显示时区 | 展示时间变化；已保存Routine与Run截止时间不变 |
| L14 | 节点为英文OS、浏览器为中文 | UI不受节点locale影响；任务使用捕获的工作时区 |
| L15 | 未知错误码、缺失翻译、超长英文 | 安全fallback；CI检出缺key；无布局溢出与内部key裸露 |
| L16 | Web无原生通知/全局热键能力 | 页面内通知正常；无假开关、无首次进入强制请求Notification权限 |
| L17 | 非owner/失效会话访问设置 | 服务拒绝写入；只隐藏按钮不能算权限实现 |


自动化测试包含schema/locale匹配/语言优先级/时间与迁移单测，API授权/CAS/outbox集成测试，两个独立浏览器context的同步/冲突/离线测试，以及IME/键盘/焦点浏览器测试。保存安全判断和Bot工作语言不能只靠字符串快照。

截图验收至少覆盖1440×900、1280×800、390×844，light/dark×中文/英文；通用页、模型页、节点不可用、电脑接管、语言保存失败、窄屏分类返回均留截图。检查中文行距、英文换行、选择器方向、禁用原因、错误布局和无横向滚动。视觉结果与真实API状态同验，不用静态美图代替流程。

## 12. 需要同步进主规格的增量清单

- 第3节：设置导航与UI语言入口、对象详情中的回复/工作语言；首版中英完整主路径与语言切换状态。
- 第5节：身份级个人偏好例外、workspace区域设置；Bot.replyLanguage、Group.workLanguage及Run/私聊languageContext。
- 第8节：`/me/preferences`、`/settings/regional`、会话列出/撤销端点及新增事件；复用现有错误/CAS/幂等，不新造设置WS协议。
- 第9节：语言快照进入Runtime上下文，显示/工作/Routine时区分离；不把UI语言写成Bot记忆或私有内容复制。
- 第10/11节：旧en/zh迁移、默认发布补丁退出计划、全站i18n与双设备行为/视觉验收，不以旧helper测试代替。
