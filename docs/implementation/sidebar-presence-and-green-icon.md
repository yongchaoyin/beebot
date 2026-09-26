# 列表同事的间歇表情与绿色应用图标

2026-09-26，接续 `04a7669` 的工作状态动作。用户明确要求列表里的 Bot
也偶尔随机做动作/表情，并将应用/Dock 图标从浅蓝改成绿色。

## 实现边界

- 沿用同一套共享头像控制器。自然模式里，可见、空闲的单 Bot 列表头像
  错峰获得一个短暂动作机会；动作只改变展示姿态，不写入 Bot 状态或制造工作。
- 每个动作片段约 1.12 秒，片段间休息 3–6 秒；按最久未参与的身份轮换，
  用身份和周期散列打散并列顺序、表情与方向。使用一个文档级稀疏时钟，
  保持姿势时不占用逐帧循环，没有每个头像自己的常驻计时器。
- 工作头像优先，总动态表面不超过两个；两位同事正在工作时立即撤销空闲动作。
  同身份的主头像和列表镜像不重复占用名额。历史消息、群头像拼图、
  小尺寸图标和自定义照片保留原约定。
- 断线、暂停、出错、等待输入时保持相应的静态表情。关闭、减少动态、失焦、
  隐藏或离屏时停止，恢复后不补播积压片段。
- 本地实际打包列表已有 `isStatic: false`，本次不放开头像组件的全局静态默认值。
  服务器列表使用相同控制器，按连接 ID、Node ID、Bot ID 区分身份；重连中的
  头像保持 offline，注销/移除/Node 变更销毁旧控制器。连接目录不代表模型或
  工作就绪，外观变化不调用模型、不发送消息、不打开会话。
- 应用图标仅把角色填色从 `#ADC3EA` 改为 Bot 绿色 `#00C972`。角色轮廓、五官、
  高光和外框保持原样。Bot 自身的蓝色、紫色等身份配置不受影响。

图标仍由 `scripts/lib/presence-icon.mjs` 生成受控
`branding/beebot-app-icon.svg`，再经标准 `icon:generate` 输出所有 PNG/ICNS
尺寸，实际安装包和界面图标使用同一来源。未引入第三方图片、SDK 或依赖。

## 回归记录

使用 Node 26.5.0 和当前锁定依赖。真实 Node integration 已重新执行：
`npm run node:test:integration` **14/14 通过、0 跳过**。该测试使用隔离 profile、
真实 Node/Host/SQLite/Shell 子进程和受控 HTTP 模型；覆盖 PKCE、断线期间完成、
重连回放、服务重启、取消子进程以及未知外部效果防重放。未使用用户账号或
向现有 Bot 发送测试消息。首次受限运行遇到本机回环 `listen EPERM`，保留失败
日志后按原命令在允许回环服务的环境重跑。

列表专门回归 **15/15 通过**，既有头像、编舞和列表合计 **69/69 通过**。
这部分执行真实 SVG/React/controller，浏览器时钟、可见性、WAAPI 使用受控替身。
验证十位同事公平轮换、真正安静的帧间隔、工作优先、同身份镜像去重、六种
停用/恢复路径、卸载释放所有时钟，以及单 Bot/群聊第二、第三条草稿的焦点、
选区和真实 FIFO 提交队列。审查发现并修复了 active ambient 销毁时重新绘制
旧脸的问题，专门的 React 回归验证复用 SVG 已绘制的新静态错误脸不会被覆盖。

服务器列表、图标专项合计 **17/17 通过**；额外原生图标独立性与素材检查由
图标子任务执行 **10/10 通过**，标准 `icon:generate` 已生成并目视检查绿色 PNG。
`npm run frontend:build` 通过，保留既有动态 import 提示。

## 严格校验修正

`verify.mjs` 原来先无条件要求退役的上游 PNG，又把适配后的 renderer 当成
未修改的上游文件逐字节比较。本次将其 pinned 分支接入打包时已使用的
`verifyChecksumPinnedRendererPackage`：先认证上游来源与 inventory，再重建
当前声明的 adapters，最后逐文件比较产物字节。身份、缺失文件、额外文件、
内容变化、签名和其他运行时校验都保留。

新增临时 ASAR 回归最终 **8/8 通过**：当前绿色 SVG/适配产物接受，删除 SVG、
修改 JS、加入未声明文件、伪造上游身份均拒绝。最终复核还实际复现了旧格式
extension 自报修改后哈希可绕过适配重建的问题；当前 BeeBot 校验入口现要求
`presence.version === 1`，补测删除 Presence 和旧格式降级均拒绝。通用 helper
的历史兼容用途没有改变。clean-source 路径仍由
`copyRuntimeAssets` 复制旧 PNG，因此只在该路径保留其兼容资产校验。

`smoke` 的 clean renderer / 11 路由来源证明是另一道尚未满足的架构门禁，
不是图标断言；本次不改为放行 pinned renderer，也不伪造 clean-source 声明。

## 完整检查和安装

首轮 `npm run package` 在测试阶段停止：1,192 通过、1 失败、15 跳过。
失败是既有 `server-preflight.test.mjs` 的真实 POSIX 探针子进程在 5 秒处超时。
原文件、原断言、原 5 秒时限单独重跑全部通过。随后仅将测试文件并发限制为 4，
执行与 package 相同的完整检查与打包链：

```sh
npm run typecheck
npm run source:typecheck
node --test --test-concurrency=4 tests/*.test.mjs
node scripts/package-macos.mjs
```

最终 **1,193 通过、15 条件跳过、0 失败**（1,208 总数），两个类型检查和严格
macOS 打包均通过；没有修改任何超时、断言、依赖锁或签名检查。
`npm run verify` 已实际执行并通过，验证 14 个 clean-source 可执行运行时、
已声明的 pinned renderer、归档摘要、原生依赖、应用身份和签名。
`npm run smoke` 仍在上述 clean renderer 来源门禁处退出 2，未声称自动原生
smoke 通过。

已备份旧版到 `.build/app-backups/BeeBot-20260926-195743.app`，再更新唯一的
`/Applications/BeeBot.app`。临时安装副本及安装结果均通过深度严格签名检查。
生成包与安装包的两个文件摘要分别一致：

- `app.asar`：`5511d34cced73a217ded52d63a31880358af1eb77ac38dfac1d2c2b488bac3dc`
- `icon.icns`：`17923137c2a9afa9c55a25bcd2476bd18917d086ccac65a1308073b639aae07e`

在 Finder 的实际「BeeBot.app 简介」中目视确认系统缩略图和预览都已显示绿色。
本次检查打开的 Finder 窗口已关闭。聊天记录、账号和 Bot 身份配置未替换。

安装版已从 Finder 打开，并核对 ASAR 入口、绿色系统图标、本地列表及单聊和
群聊界面。群聊键入 `@` 后只有一套原生 Mention 列表；协作入口显示已完成
数量。单聊和群聊可通过原生键盘打开，中文临时草稿可编辑，单聊键盘续写成功。
所有临时草稿已清空并返回原群聊；没有向任何现有 Bot 发送测试消息。

原生自动点击本地列表一度未触发打开；使用同一行的键盘 Space 后正常切换。
只读审查实际安装的点击路径未发现本次头像适配器拦截点击，主进程采样也没有
钥匙串阻塞。该观察不等同于鼠标点击矩阵通过，也没有据此改动导航逻辑。
原生中文 typeText 和剪贴板操作曾受工具限制，改用可访问编辑区域 setValue
并用真实键盘续写验证，未把自动操作工具的失败当作产品测试通过。

原生仅检查当前浅色、普通宽窗口和现有中英混合文案，未改变用户主题、语言、
动作偏好或模型配置。没有在原生截图中完整量测间歇动作周期；其时序、限额、
减少动态、离屏与焦点行为由上面的真实控制器受控时钟测试覆盖。实际模型下
工作中的第二、第三次发送未在用户会话中执行；提交队列与隔离 Node 覆盖见上。

最终仅改动校验脚本和两条拒绝回归后，重新运行 verifier suite（8/8）及
`npm run verify` 均通过；没有重复全量测试或改变安装包，所以全量统计仍为
前述 1,193 通过，不把额外两项写成重新全量通过。安装包包含当时工作区已有
的独立修改；本次提交不包含那些先前已有的文件改动。

忽略的本机日志：`.build/sidebar-package-first-attempt.log`、
`.build/sidebar-preflight-rerun.log`、`.build/sidebar-package-final.log`（终端
输出中段被工具截断，最终统计与完成状态保留）、`.build/sidebar-verify.log`、
`.build/sidebar-smoke.log`、`.build/sidebar-node-integration.log`、
`.build/sidebar-node-integration-sandbox.log`、`.build/sidebar-motion-final.log`。
最终校验补测日志：`.build/sidebar-verify-presence-before.log`、
`.build/sidebar-verify-presence-tests.log`、`.build/sidebar-verify-presence-final.log`。
