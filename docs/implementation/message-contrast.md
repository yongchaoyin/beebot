# 消息气泡可读性修复

基线：`c797dbdc48fede944c36fb38a21f14df4b3fc5d5`（PR #15，包含 #14 模型绑定与品牌修复）。

## 根因与修改范围

用户截图的浅蓝色气泡仍使用白字。固定版本渲染器的 `KWn` 用户气泡带有
StyleX 类 `sand-70xvah`；其三重 ID 排除选择器把文字设为
`--cursor-text-invert`，优先级高于 Presence 的普通 `.sand-message` 规则。
`BPn` 正文继承该颜色，因此只修改气泡背景、或仅测试源码聊天组件，会漏掉问题。

在当前固定版真实气泡与 CSS 的浏览器复现中，原正文为 `#FCFCFC`，背景为
`#E8EFFC`，对比度约 **1.126:1**。这是代码路径复现，不是读取用户电脑配置。

- 浅色用户气泡改为 `#DCE7FA`，文字 `#20242B`；深色保留 `#273856`，文字 `#F1F3F6`。
- 新增成对的 `--bb-user-text`、`--bb-mention-bg`、`--bb-mention-text`。
  提及/引用标签在浅色用 `#CCDDF7`＋`#20242B`，深色用 `#354B70`＋`#F1F3F6`。
- 独立 `message-colors.css` 仅对用户气泡和正文容器做必要的高优先级覆盖，
  不修改全局 inverse/on-color 变量，不对所有后代应用文字颜色，不改变头像 SVG。
- 提及和引用标签获得配套前景/底色；消息链接保留独立颜色，并显式加下划线，
  避免原 StyleX 的 `text-decoration:none` 抹掉链接标识。
- 普通引用、代码、错误与作者信息保留各自语义色。强制颜色模式使用系统色，
  不关闭 `forced-color-adjust`。
- 选择高亮与气泡底色区分。发送按钮只保留按压位移动效，不单独渐变底色；
  后者会在深浅主题切换的中间帧短暂出现深字配深底，端点色本身并非错误。

两条入口都从共享 Presence 样式获得修复：可编辑/远端聊天组件，以及固定版
打包适配输出的 `beebot-presence.css`。无需编辑上游归档或生成后的 JS/CSS，
原来的来源校验、渲染器锚点校验和重建校验保持不变。

不修改消息内容、发送队列、认证、模型路由、头像身份或工作执行行为。
截图中的处理失败提示是另一项业务状态；提高可读性不等于解决其执行原因。

## 回归与复现

新增 `tests/message-contrast.test.mjs` 与 `tests/helpers/message-contrast-harness.mjs`。
辅助程序从固定版文件提取原始 `KWn/BPn/Sle`、样式常量和 StyleQ，挂载真实组件，
而非手工画一个看起来相似的气泡。找不到固定锚点即失败。另挂载源码的
`ConversationTranscript`、`ConversationComposer` 和发送队列。

在已执行 `npm ci` 与 `npm run bootstrap` 的仓库根目录运行：

```sh
node --test tests/message-contrast.test.mjs tests/presence-theme.test.mjs \
  tests/presence-transcript.test.mjs tests/presence-reliability.test.mjs \
  tests/presence-packaging.test.mjs tests/window-layout.test.mjs
npm run typecheck
npm run source:typecheck
npm run frontend:build
```

本轮本地结果：上述 **61 项通过，0 失败、0 跳过**，其中新增 7 项；两套类型检查、
前端构建通过。构建仍有既有动态/静态混合导入提示，不称为构建零警告。

独立 Playwright/Chromium 回归有 **227 项检查通过、200 组实际文字颜色测量**，
覆盖 1100×980、512×700、390×650，单聊/群聊、浅色/深色、正文/粗体/提及/链接/
代码/引用/回执，以及排队、发送、失败、不确定送达状态。浅色正文约 **12.497:1**，
深色正文约 **10.575:1**；该测量集合最低为浅色引用 **4.949:1**。
普通文字目标采用 WCAG 2.1 AA 的 4.5:1，比较原始浮点结果、不将失败值四舍五入。
规范来源：https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum

交互验证包含：链接响应、头像颜色不被覆盖、主题切换不重建输入框或清除草稿与
光标、单聊和群聊在首条未返回时继续发送三条并按原顺序推进、强制颜色模式。
Browser 插件未提供；使用已有 Playwright 与 Chromium。环境阻止 localhost
HTTP 导航，因此从内存载入相同编译组件和真实样式，不绕过网络限制。

浏览器账号/名册、链接跳转、数据校验入口与网络回执采用受控样例。富文本使用
合法测试数据；这不是输入校验、浏览器导航安全、完整安装应用、真实模型或
服务器任务执行验收。测试页面的布局外壳只用于展示两套组件，不是产品的新页面。
浏览器测量补充 happy-dom 的 CSS 继承差异，不能以 happy-dom 代替真实样式引擎。

## 交付与限制

代码、测试和本文档随 PR #15 继续提交；不自动合并、不发布安装包。
新构建会修复既有消息的显示，无需删除 API、Bot、聊天、Keychain 或数据卷。
旧安装包不会自动获得源码改动。实际 Mac/Retina/自定义字体、完整服务端与真实
用户历史仍需相应环境验收；不把配色通过写成全软件无缺陷。
