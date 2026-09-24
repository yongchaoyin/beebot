# BeeBot 窗口控制区与界面遮挡回归

基线：PR #14 `29920ee0543c697a23ee7bcec2a61bbf7f75061f`。
承接模型绑定及品牌修复，不改认证、模型配置、Bot 数据和现有头像动作。

## 原因与修复边界

截图中的三个按钮属于原生 macOS 窗口，不是网页元素。窗口使用
`hiddenInset`，原生按钮位置是 DIP `{x:16,y:15}`。此前在固定版渲染器
`pcn` 的左侧空白插入 BeeBot 标题，却没有为原生按钮预留空间；网页的
z-index 不能把标题正确放到原生控件前后。这不是修改用户缩放设置能够
根治的问题。

额外发现：可编辑前端的 WorkspaceIndicator 与聊天标题共用了
`.sand-chat-header__title`，其 `position:fixed;top:0;left:16px` 会影响
业务标题。旧的透明 `.sand-cover-drag` 覆盖顶部 52px，可能让首屏按钮
落入拖动区域；设置和首次引导中的固定尺寸在短窗口下也缺少可靠的滚动边界。

## 共用的窗口布局约定

- `source/shared/window-layout.ts` 维护原生按钮位置与 caption 尺寸。
  macOS 保留 44 DIP；Windows/Linux 分别预留 51/52 DIP。没有绘制假按钮，
  也没有隐藏原生关闭/最小化/全屏功能。
- `installNativeWindowLayout` 在真实窗口状态的 `useLayoutEffect` 中调用，
  为业务内容设置顶部安全区，而不是只移动某个标题。CSS 值除以现有
  `--sand-zoom-factor`，让原生保留区域不会随网页缩放缩小。
- `#beebot-window-caption` 是唯一的新窗口拖动条；旧透明拖动盖层清零。
  标题、搜索、按钮、输入、链接和弹窗均明确排除拖动，不修改点击业务逻辑。
- 原生全屏状态取消保留条，退出后恢复。使用现有桥接与窗口事件，不新增 IPC、
  网络请求、轮询或凭据。
- 多个窗口控件组件可能同时挂载：按 document 共享所有权，逆序关闭一个弹层
  不会移除主页面仍需使用的安全区。最后一个组件卸载时恢复之前的属性与样式。
- WorkspaceIndicator 使用独立 `.bb-window-workspace-label`，其标题范围避开
  左右原生控制区；不再用固定位置规则覆盖聊天标题。
- 正式打包的固定版 `xPe` 与可编辑前端 WindowChrome 都调用同一个实现。
  适配器只替换已确认的源码锚点，锚点漂移即失败；不改原始归档或放松校验。

选择独立 caption 行是为了让折叠/展开侧栏、选择模式、首次引导等路径遵循
同一个几何约定。不要再为不同标签添加零散的左移/下移补丁。

## 同类布局问题

| 区域 | 修复 |
| --- | --- |
| 侧栏标题、新建入口 | 全部在 caption 下方，标题不挤压加号。折叠后不再留一个空 header 行，仍保留原有 rail 新建按钮。 |
| 窗口状态点 | 可编辑前端的状态点与工作区名称原先同时居中，现分配不同区域，不再压住标题。 |
| 附件长文件名 | PDF 预览使用可收缩标题和固定工具/关闭区域，避免长文件名将关闭按钮推到视口外。 |
| 会话长名称 | 标题容器可收缩并省略，操作按钮不收缩；不删除或改写真实名称。 |
| 设置弹窗 | 窄屏两列使用 `minmax(0,1fr)`；导航与内容分别可滚动，末尾项目可到达。 |
| 设置关闭按钮 | 源码 h2 与正式版 PaneHeader 都预留关闭按钮区域，长标题不会占用点击位置。 |
| 新建 Bot/群聊 | 现有居中弹窗限制在 caption 下方与视口内，长表单可滚动；不改变提交、取消、焦点恢复与草稿协议。 |
| 文件、媒体、图表预览 | 这些 viewport-fixed 层单独设置 safe top，不能指望 body padding 影响它们。 |
| 首次引导 | 固定视口层避开 caption；绝对定位的 tour 使用至少 600px 内容画布，短窗口滚动而不是裁掉标题和 Next。 |
| 全屏电脑弹窗 | 带动画/expanded 标记的全屏弹窗排除在普通紧凑弹窗 max-height 覆盖之外，保留原扩展几何。 |

部分固定版 StyleX 使用 ID 级别的原子选择器。覆盖仅对上述具名区域使用
必要的 `!important`，不全局替换原始 CSS、不把固定版原子类与重建原子类混用。

## 回归方式

1. `node --test tests/window-layout.test.mjs` 验证布局所有权、缩放表达式、
   状态切换、清理、内容/焦点保留及实际固定版渲染器的挂接点。
2. 继续运行既有创建、连续消息、Presence、设置和发布检查。不能用静态截图
   替代业务回归，不能为了通过而跳过描述/模型绑定/认证测试。
3. Chromium 离线组件几何与交互矩阵：1100×740、512×520、390×420，展开/折叠、
   长标题、窗口/全屏状态、三种平台布局；使用实际 pcn、Ta、PaneHeader 以及
   可编辑 SidebarHeader/WindowChrome/SettingsModalShell/OnboardingStep。
   网络、账号、部分叶子按钮回调和内容为样例。Browser 插件未列出，使用 Playwright；
   本机 HTTP 被环境策略阻止，因此使用内存 HTML 加载相同编译产物，不绕过策略。
4. macOS：`node scripts/verify-native-window-layout.mjs`。
   使用锁定 Electron 包中的发布校验和下载对应原生运行时，macOS ditto 解压到隔离临时目录；
   不依赖当前 Node 工具链中会提前退出的 extract-zip，不改依赖或关闭校验。
   创建隔离的真实 Electron BrowserWindow，使用项目真实 `windowChromeOptions`、
   固定版 pcn/xPe、原有 CSS 与新增公共样式，检查实际原生按钮配置和
   75%/100%/125%/150%/200% 网页缩放、最小窗口、真实 enter/leave-full-screen。
   通过 Electron 输入事件验证 New 回调，并核对草稿不变。结果输出到
   `.build/window-verification`，可用 `BEEBOT_WINDOW_REPORT_DIR` 指定证据目录。

验证脚本不启动 Host/模型/服务器，不读取已有 userData；Native 验证不是完整
安装后的用户账号验收，`capturePage` 图像仅含网页内容，不能假称包含原生按钮。
最终运行结果以 PR 的检查记录与附件为准，本文不预先标记未执行的检查为通过。

## 实机补充验收与维护

合并/切换包含本次代码的分支后重新构建应用，继续启动旧安装包不会加载修复。
保留现有 Bot、模型 API、Keychain 和 Docker volumes；本次不需要数据迁移。

发布前仍需实际安装环境检查：Retina/外接屏切换、原生按钮真实点击、手动拖动、
Mission Control、系统辅助功能字体设置、系统全屏动画以及硬件输入法。
本轮只能对明示覆盖的页面、尺寸、状态负责，不作“整个软件永远没有布局 bug”的承诺。
后续新增 fixed 弹层必须说明其视口与 caption 的关系，并加入矩阵，不能复用
`.sand-chat-header__title` 这样的业务类做窗口层定位。
