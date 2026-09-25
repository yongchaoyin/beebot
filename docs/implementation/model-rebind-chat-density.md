# 已配置模型仍不可用：正式模型绑定桥接与聊天密度修复

基线：`47b34efc133084528ccba44ac84783b88183252b`，承接模型目录同步、品牌、原生窗口和气泡对比度修复。

## 复现与根因

用户的新截图已显示新的品牌、顶部安全区和深色正文，但发送 `hi` 仍提示 Bot 绑定的模型 API 在执行环境中不存在。这不能继续归结为用户没更新，也不能只修改错误文案。

这次找到并复现了正式渲染器的实际调用契约错误：

```js
// 错误：这是 roster 的公开方法，不是底层 RPC。
window.__sandUpdateAgent = (id, profile) => e.updateAgent({ id, profile });

// 正确：公开方法接收两个参数，由真实 roster 适配器再组织 RPC 对象。
window.__sandUpdateAgent = (id, profile) => e.updateAgent(id, profile);
```

固定版的 `hHn` 提供 `updateAgent(id, profile)`；其内部 `Te` 才调用底层
`updateAgent({ id, profile })`。旧桥接把对象当成 ID，把 profile 传成 undefined。
真实 Host 的 `AgentLifecycle.updateAgent` 因此不能保存正确的模型绑定。上一轮
选择器测试直接替换了 `window.__sandUpdateAgent`，遗漏了这层公开 API 契约。

这是可重现的代码缺陷，并非已经读取用户设备后确认的唯一故障。供应商认证、额度、
网络、实际安装版本以及已经失效的历史绑定，仍需各自按真实状态判断。

## 功能修改

1. 修正实际打包入口 `MOn` 的二参数转发，不修改 Host/RPC 公共协议。
2. 显示模型时优先读取当前 roster 的权威行；内存绑定仅在无行时作为兼容缓存。
   更换 roster 实例清除该缓存，避免旧连接的 Bot ID 覆盖新实例的同名 ID。
3. 同一个设置 DOM 被另一个 Bot 复用时，重新建立选择器的所有者绑定，避免
   onchange 仍然捕获旧 Bot ID。模型目录请求和保存响应同时核对面板、Bot ID 和 roster。
4. 只有 Host 返回的 Bot ID 与保存的模型 ID 均吻合，才显示“已保存”。null、错对象、
   错模型、拒绝或连接切换都不能伪装成功。迟到结果不更新已切换实例的 UI 缓存。
5. 未确认结果提示用户核对，不声称“服务器一定没有改动”，不自动重试、不更换模型。
   名称按原表单提交，职责、描述、头像、其他成员和聊天草稿不被顺带重置。

已失效的旧 API ID 不会被猜测映射到另一模型。升级后用户在对应 Bot 设置中选择一次
确实存在的 API；现在这个保存操作会沿正确契约落盘。它不会重新执行历史失败任务。
远端 Node 的模型管理仍归所属服务器，本修改不把远端流量改道到本机。

## 聊天布局

共享 `chat-density.css` 同时进入源码界面和正式 `beebot-presence.css`：

- 聊天头部使用 border-box、最小 52px；不侵占独立的原生 caption 安全区。
- 消息正文 14px/22px，气泡内边距 6px/12px、圆角 14px；普通行间隔 12px。
  正式虚拟行只改可测量盒子的内部留白，不重写绝对定位、transform、缓存高度或滚动锚点。
- 成员行减少重复内外 padding，空的 Routines 说明紧跟内容而非撑满后垂直居中。
  右栏关闭和用户已保存的可拖动宽度不改变，非空任务列表与编辑器不套用空态规则。
- 错误卡片缩小字号与留白；多个错误保留在有界可滚动区域，不删除错误、重置工作或遮掉输入框。
- 仅明确携带 `kind=notice, code=delivery_failed` 的系统记录显示为单语言摘要。
  点击或键盘展开可查看原始完整文本（包括成员名）、原 ID 和 replyTo；历史数据库不改写。
  普通消息、无 code 的历史记录、安全冻结等其他 notice 不按文字匹配折叠。

`conversation-notice.ts` 使用调用方现有的 React。固定版 lazy notice 入口
`view-1r0bwdK4.js` 经精确 SHA-256 校验后包装原组件，共享展示不可用时回退原组件。
修改记录进入原有渲染器扩展清单；原始输入、CSP、哈希漂移失败和重建检查均保留。

## 回归边界

`tests/model-rebind-contract.test.mjs` 提取实际打包的 `MOn`、`hHn` 公开适配器和
选择器，连接真实 Host 的模型配置处理、profile 文件与 SQLite：

- 用实际配置处理器创建两个 API；旧 Bot 指向已删除的 API，执行端解析先明确失败。
- 在真实选择器发起 change，经实际桥接和 roster 参数转换，到真实 profile 更新。
- 返回的摘要匹配，并在新 store/下一轮生产解析中获得选定的模型和对应快照凭据。
- 覆盖当前单 Bot 与非当前群成员 Bot 的修改，其他成员、描述、头像与草稿不变。
- 拒绝时由实际 roster 回滚；不同运行实例的缓存与迟到结果不会串用。

测试中的 transport、roster 事件记账、浏览器名册和密钥是受控样例；没有用户 Keychain、
付费模型网络请求、真实 Electron IPC 或完整多 Bot 执行。群成员用例证明修改非当前成员，
不是已经完成整个群聊模型端到端验收。

`tests/model-binding-ui.test.mjs` 增加未确认摘要、错 Bot/模型、连接切换以及复用设置面板的
回归；`tests/chat-density-feedback.test.mjs` 验证原记录保留、未知通知原样展示和正式 lazy
入口。既有对比度、模型解析、连续发送和打包适配测试继续运行。

浏览器使用现有 Playwright/Chromium；Browser 插件未提供。本环境阻止 HTTP 导航，
因此加载内存中的相同编译组件和真实样式，不绕过网络限制。测试外壳不是新的产品页面。
固定版气泡、notice、成员、空任务组件与源码 transcript/composer 都被挂载；部分叶子控件、
页面外框、账户和传输是测试替身。原生虚拟滚动引擎、真实服务器及用户已安装应用未在
该夹具中运行，不能以截图代表它们通过。

本地最终 155 项针对性测试通过，0 失败、0 取消、0 跳过；包含 13 项新增用例。
覆盖真实 roster 桥接、Host/profile/SQLite、打包资源重建、既有对比度与连续发送。
前后端类型检查及前端生产构建通过；既有混合静态/动态导入提示仍在。
这些测试是完整 CI 的子集，不与全套数量重复累计。

本轮浏览器 105 项检查通过、0 pageerror/console error/warning，覆盖 1440×900、1024×740、
512×700、390×650；浅深色、摘要键盘展开、语言切换、草稿/节点身份、错误滚动、成员收放，
以及单聊与群聊在第一条未返回时继续发送三条并按顺序推进。截图故意保留示例错误，
用于验收错误布局，不代表仍发生真实模型请求失败或已取得模型成功响应。

局部实测在相同 1440×900 夹具中：原系统失败通知 60px → 28px；错误卡片约 96px → 78px；
头部约 57px → 52px。值不代表所有用户屏幕、系统字体和缩放下的固定高度。

## 重跑

使用仓库锁定版本的 Node 26.5.0，先安装依赖并准备固定运行时：

```sh
npm ci
npm run bootstrap
node --test tests/model-rebind-contract.test.mjs tests/model-binding-ui.test.mjs \
  tests/model-binding.test.mjs tests/chat-density-feedback.test.mjs
npm run check
npm run frontend:build
```

完整 Mac 包需要在支持的 macOS 环境构建；此更改不改安装签名策略、认证授权、模型目录
同步和持久化命名。不要删除 Bot、历史、模型 API、Keychain 或 Docker 数据卷。
