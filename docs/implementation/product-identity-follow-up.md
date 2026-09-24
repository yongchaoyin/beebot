# 产品标识清理复核与构建闭环

基线：`a43d61ce98ad7e2ab6e443c6e78622bd1a58c587`，PR #16。
本轮延续 `product-identity-audit.md`，不覆盖此前模型、窗口、气泡、头像或服务器安全改动。

## 新发现与处理

1. **完整 CI 的图片输入缺失**：`router-settings.test.mjs` 仅复制两份 JS 和入口 HTML，
   而生产转换现在要求核对九份待退役图片。已在本地复现相同的 ENOENT。
   测试改用完整固定版渲染器输入，仍核验注册表与 landing 变换的组合顺序，另外验证
   九份文件只在输出中删除、原始文件保留。没有把缺失输入改成忽略，也没有跳过测试。
2. **错误的订阅归属**：旧服务准入说明被机械替换成“BeeBot needs an Ultra plan”
   或“Premium seat”。新增共享 `source/shared/product-access-copy.ts`，明确这些拒绝
   来自外部托管服务，不是 BeeBot 订阅。本机模型和独立授权服务器是分别配置的连接。
   源码及打包版的 Yvn/Zvn/dzn 使用同一份说明，原组件/表的哈希不符即停止构建。
   托管访问状态、失败原因、恢复限制均保持，**不因为改文案而放行、换账号或改路由**。
3. **已不可达的付费 UI**：六个可选模型供应商均走 external 用量展示，旧试用取消、
   Ultra/Premium 升级和原产品账单分支已不可达。删除这段 UI 及其桌面回调、确认状态、
   开发预览虚假账单样例；不更改账户后端的历史协议实现。默认展示 OpenRouter，旧的
   非可选 provider 显示未激活，不冒充另一家模型。正式打包 RRouterUsage 的历史 provider 分支也不再挂载旧计费面板，避免旧配置使已下线的购买入口复活。保留真实供应商的本地用量统计。已存在外部服务会话仍可以明确退出。
4. **旧帮助与承诺**：源码访问帮助改为 BeeBot 项目文档，与正式渲染器一致。
   残余隐私/试用提示明确外部服务归属，不沿用旧产品的训练数据或自动扣款保证。
   仍实际操作供应商设置或 marketplace 的链接不虚构替换为 BeeBot 服务。
5. **图片引用检查不完整**：清理前递归检查整个渲染器根目录，包含入口 HTML、嵌套
   JS/MJS/CSS/SVG 和 webmanifest，而非只查 assets 同层。全部待退役文件先验证摘要、
   存在性、普通文件类型和引用，再删除；拒绝符号链接及越出审计根的路径。
   此检查不声称能证明任意运行时字符串拼接；待删除项仍是固定版本、精确哈希清单。
6. **源码设置关闭按钮被原始样式覆盖**：浏览器复核中，公共按钮的高优先级定位类
   覆盖了设置关闭按钮的位置，使它跑到内容左侧。只对该按钮固定右上操作位，不修改
   通用按钮或聊天布局；在两种设置内容入口、两种尺寸/主题/语言中验证位置和键盘导航。
7. **访问说明的可读性**：源码访问标题与正文原来由相邻 span 连成一句，深色帮助按钮白字配浅底。改为独立标题和段落，帮助按钮用成对的主题前景/底色；实际浏览器核验段落间距与 4.5:1 文字对比度，不改变拒绝或帮助点击语义。
8. **审计守卫**：补上产品名称大小写变化、入口 HTML 和旧 onboarding 链接回归；
   普通 cursor 属性、真实 Grok 模型标识、供应商 API 和许可证仍不会被重命名。
9. **安装包的隐蔽图标残留**：实际挂载 DMG 后通过 `assetutil --info` 确认，主应用
   `Contents/Resources/Assets.car` 只含旧 `icon` 及其分组、颜色、纹理和多尺寸变体。
   SHA-256 为 `95de5001cddd503a354f471c772d09fd2501e9c37abfeeb078ad6f33994507ed`，
   先前只是移除 `CFBundleIconName`、让新 ICNS 优先，并没有删除这份废弃资源。
   现在打包时显式选择自有 `icon.icns`，核验图标与生成文件一致、所有输入为普通文件、
   节点是已改名的 BeeBot.app，且 catalog 符合精确摘要后才移除。引用归档不变；
   不按 `.car` 扩展名删除其他资源或框架。变更、缺失、路径间接引用均失败。签名后
   再验证其缺席和自有图标一致性，原始代码/原生依赖/ASAR 校验仍保留。
10. **旧账单与反馈入口文案**：源码设置、正式注册表、命令面板及 Agent 指南统一显示
    `Usage`，持久 section ID 仍为 `usage`。保留历史反馈接口的失败码，但其错误说明
    明确属于外部服务，不再要求“升级 Ultra”或登录 BeeBot 才能反馈；BeeBot 自己的
    Feedback 仍走项目入口。固定版 OVn 表使用精确哈希与共享错误表替换，不放行
    订阅/账号限制、不切换后台、也不把外部反馈误发到自有目标。


## 不能当作无用代码删除的部分

工程当前仍有固定渲染器、原生 ABI 构建素材、CSS/glyph 映射、持久数据身份和实际
Cursor 后端调用，不是“全部已被独立源码替代”。审计报告把这些列为需要依赖复核，
不把字符串零命中作为验收。若要完全退役，需要分别替代运行时、移除实际服务调用、
迁移已有数据和密钥，再删除对应输入。否则会丢模型、图标、会话或构建能力。

原始归档的图片不作为 BeeBot 页面/安装背景使用；九个已替代图片和一份旧图标 catalog
从最终输出删除，两个精确清单和字节校验都生效。现有许可证、来源、重建证据不删，不篡改用户消息及历史。

## 验证命令

使用 `.node-version` 指定的 Node 26.5.0，先 `npm ci`，macOS 执行 `npm run bootstrap`。

```sh
node scripts/audit-product-identity.mjs --json /tmp/beebot-product-identity.json
node --test tests/product-identity.test.mjs tests/product-identity-boundaries.test.mjs \
  tests/product-branding.test.mjs tests/router-settings.test.mjs tests/native-brand-assets.test.mjs
npm run check
npm run frontend:build
npm run publication:check
node scripts/package-macos.mjs
node scripts/package-dmg.mjs
```

新增 `product-identity-boundaries.test.mjs` 覆盖 50 个状态/原因组合、原准入 gate 不变、
纯帮助导航、固定锚点漂移、五类引用来源、缺失/非普通文件/符号链接/越界根、别名守卫、
六个供应商及旧 provider 用量 UI、关闭按钮定位、Usage 注册表和历史反馈错误码。
新增 native-brand-assets 的 6 项测试校验旧 catalog 精确删除、自有图标/选择器、
符号链接拒绝、缺失/未知输入、全计划先验与签名前后验证。

本地相关单元/组件回归 **113 项通过，0 失败、0 取消、0 跳过**，包含新增 24 项；前后端 TypeScript 与前端构建通过。这些是完整套件的子集，不与 CI 计数相加。

本地 Playwright/Chromium 本轮 **383 项断言通过**，0 页面错误、0 console error/warning。
包含 1100×760 与 390×650、源码 GeneralSettingsPanel、正式版实际替换的 Vs、中英/浅深色、
真实 Enter 导航、无旧账单导航文案、关闭按钮操作位、旧外部会话确认与退出、用户草稿原文不变；另检验实际
AccessCover/UsageSettingsPanel 的外部服务说明、帮助点击及无购买入口。测试比较旧方案
并不代表所有代码都已彻底独立。

浏览器在内存页面载入相同组件与样式（Browser 插件未提供，使用现有 Playwright），
账号、确认和目标页面回调是受控数据。访问说明截图的外层仅用于放置独立组件。
不把组件验证当作完整 Mac 安装、真实登录、真实服务器或真实计费操作验收。
节点测试仍会输出既有 Happy DOM 安全测试环境提示；前端构建仍有既有混合导入提示。
最终 macOS 全套、原生窗口和实际打包结果以 PR 中明确绑定提交的 CI 记录为准。
