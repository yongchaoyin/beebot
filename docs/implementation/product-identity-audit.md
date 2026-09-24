# 产品标识与旧依赖审计

基线：`b761d7620854a867b7b7b1f2eb77ff71a0a20cb3`（PR #15，承接 #14 的模型、品牌、窗口与消息对比度修复）。

## 结论

本次同时检查索引内源码、文本、文件名和实际生成的正式渲染器。当前工程并非已经脱离上游：正式 UI 仍使用固定归档和源码适配器，Electron/native ABI 和部分外部服务仍有真实依赖。因此不能把所有 `cursor`、`grok` 命中都当作无用代码删除，也不能更换真实模型/API 名称来伪造独立实现。

清理的目标是：自己的产品界面与 Agent 不再错误地自称旧产品，不把旧厂商账户当成本机/独立 Node 的准入条件，最终产物不携带已被替换的无用产品图片；保留合法归属、正在使用的服务契约和已有用户数据。

## 本次实际修改

| 范围 | 修改 | 未改变 |
| --- | --- | --- |
| 产品文案 | 开发页 title、更新/恢复/反馈提示、Agent 系统身份、记忆摘要提示、工具错误、操作系统通知使用 BeeBot | 不改用户消息、历史记录、真实供应商/model ID、API URLs |
| 实时文案来源 | `UI_TEXT` 从历史 `production/evidence.ts` 拆到 `production/ui-text.ts` | 原始证据锚点、第三方许可和来源仍保留 |
| 通用设置 | 两条实际连接入口：本机模型 API、独立服务器连接；已登录外部服务仅保留退出/取消正在登录的维护操作 | 不创建假 BeeBot 账户，不清掉旧凭据，不降低设备授权要求 |
| 正式设置 | 同一个无 React 依赖的组件工厂接入固定渲染器现有 React；替换原 `Vs` 展示函数，哈希不符直接失败 | 不替换认证 store、OAuth、RPC 或模型配置写入 |
| 账号菜单 | 除已有点击入口，还替换可以由键盘打开的原生组件 `Xln`，移除旧官方账户、计费、iOS 下载与反馈入口 | 真实 Settings、Router、About、项目文档和 issues 入口保留 |
| 内部显示包装 | `CursorIcon` 改为 `WorkspaceIcon`；自有头像包装类/状态属性改为 `bb-bot-mark` / `data-avatar-state` | 八种形状、十一种颜色、动态实现和照片分支保持 |
| Agent 的代码任务 | 移除“所有代码必须转给 Cursor”“云工具关闭就不能处理代码”的厂商强制引导；按实际可用、独立授权的工具处理 | 保留 Auto-review、用户确认、无凭据盗取/权限绕过、不能私自强推等边界；不新增任何工具权限 |
| Agent UI 帮助 | 修正真实 General/Servers/Router/Usage/Updates 路径，以及本机模型与远端模型的区别 | 不对已有历史/用户记忆作批量替换 |
| 诊断 | 进程名脱敏同时识别新 BeeBot Helper 和旧升级前 Helper | 不改变持久进程身份或记录额外用户路径 |

## 无用图片的处理

旧应用 PNG，以及 8 个无引用的命名/红绿蓝头像 SVG，共 **9 个文件、225,058 字节**，从最终渲染器输出中移除。

精确文件与 SHA-256 在 `scripts/lib/retired-brand-assets.json`。`retireUnusedBrandAssets` 先核对全部字节和最终 JS/CSS/HTML/JSON/SVG 中的引用，全部通过才删除。任何文件改变或出现新引用，构建失败，不能“删了再补一个空图”。

移除记录包含路径、原始大小、摘要与原因，进入 `renderer-router-extension.json.retiredAssets`。现有 ASAR 校验仍从不变的原始目录完整重建，并逐项比对目录和字节，不增加允许任意遗漏文件的豁免。原始归档及研究素材不修改；它们不是提供给用户安装的 BeeBot 产物。

仍然使用的中性应用 SVG、动态头像，以及真实第三方连接器的图标不删除。

## 为什么还有 cursor / grok 字符串

| 保留项 | 具体证据/位置 | 后续完整退役需要做什么 |
| --- | --- | --- |
| 构建基准 | `research-archives/original/`、`scripts/lib/config.mjs`、bootstrap、renderer reconstruction | 先用可独立构建的渲染器/原生依赖替代，再移除归档。不能先改哈希或取消签名来源检查 |
| CSS/图标契约 | `--cursor-*`、`cursor-light/dark`、glyph registry 和 `cursor-icons` 字体 | 原子迁移所有引用与图标映射，验证搜索、关闭、工具、菜单和全部状态。直接删字体会让普通图标也丢失 |
| 持久身份 | `src/app/package.json` 的内部 sand/productName、Windows profile、容器/数据卷及密钥名 | 必须有用户数据和 Keychain 的真实升级迁移；本次不触碰这些值 |
| 活跃外部集成 | `source/shared/node/cursor-backend/`、account、cloud-agent、managed marketplace 等仍有调用链 | 逐个撤掉业务入口、替代或移除客户端/协议实现，并验证既有任务/账户退出。不能简单改域名为 BeeBot 或说已完全离线 |
| 真实模型名称 | Grok 等供应商/模型标识、第三方图标 | 不应换成 BeeBot；否则会发错模型或误导服务归属 |
| 语义相同的普通词 | CSS cursor、编辑器光标、分页游标、dropcursor/gapcursor | 与品牌无关，不处理 |
| 许可证/历史证据 | LICENSE、NOTICE、PROVENANCE、generated/evidence/research/tests | 保留来源与法律归属，不能据此声称仍把旧品牌当产品展示 |

本次未把内部 Cursor 服务域名改成不存在的 BeeBot 服务，未删除第三方版权，也未宣称切断所有上游网络依赖。独立 Node 的认证与已有 DPoP/设备权限/任务冻结完全不变。

## 防止再次引入

`node scripts/audit-product-identity.mjs --json /path/outside/repo/identity-audit.json`

扫描 Git 索引项目文件，不读取个人配置、用户目录、密钥、缓存或 node_modules。报告全部命中文件及分类示例；名称带 `review` 的分类是依赖复核提示，**不代表自动认定死代码**。

`tests/product-identity.test.mjs` 检查活跃自有 TS/TSX/JS 文案，不允许再出现未声明的 Grok Bot 产品身份，且通过 AST 忽略注释与保留的重建证据。测试故意注入一个新旧品牌文案验证能拦住。另检验普通 cursor 不被误判、真实 provider/模型 URL 不被篡改、素材变更/引用回归会阻断删除。

固定版组件的哈希 guard 保留，无法找到原组件不应用模糊替换。源码与正式版 UI 共享 `product-connections.ts` 的实际组件工厂，不增加重复 React。

## 本地验证记录

- Node 26.5.0，前端/服务端 TypeScript、前端 build 通过。构建仍有既有混合静态/动态导入提示，不称“全部零警告”。
- 相关单元/组件回归 **96 项通过，0 失败、0 跳过**，其中新增9项；覆盖菜单、头像/消息/主题、窗口和原始 renderer 适配。
- Playwright + 系统 Chromium **176 项检查通过**，无页面/console error/warning；1100×760、512×660、390×650，两种入口、中英、浅深色，真实 Enter 键激活模型/服务器入口、草稿不改写、已存在会话可明确退出/取消、本机模型不伪装成旧账户。
- 浏览器使用原始 CSS、真实源 GeneralSettingsPanel 与实际改写的 Vs 组件。账号、确认与目的页为受控数据；不是安装后的 Mac、真实授权/模型调用，也不是完整设置页面的人工验收。测试外壳不是新增产品页面。
- 本地额外运行 `presence-packaging.test.mjs` 时，ASAR 创建步骤出现 “Promise resolution is still pending but the event loop has already resolved”，该文件被取消。因此本地未取得完整 ASAR/原生安装包验收，**未删除该测试、未放宽校验**。正式 macOS CI 结果另在 PR 记录，不拿之前提交的通过结果替代。

## 验收与交付

在新的功能分支检查后，需由维护者按堆叠 PR 顺序合入开发分支并重新构建 BeeBot。仅运行旧安装包不会更新页面。无需删除模型、Bot、对话、Docker volumes 或 Keychain。

本次是产品身份清理与依赖审计，不是完全移除上游框架/服务的最终重构，也未签名发布安装包。下一轮要真正脱离上游，应分别验证可编辑渲染器成为默认、原生模块独立构建、旧服务退役及持久身份迁移，而非继续盲目全局替换。

## 后续复核

针对 `a43d61c` 的完整 CI 输入缺失、残留订阅归属、不可达账单 UI 和跨目录图片引用，
见 [产品标识清理复核与构建闭环](product-identity-follow-up.md)。上面的 96 项/176 项
为首批本地记录，不应代替后续提交的独立验证。
