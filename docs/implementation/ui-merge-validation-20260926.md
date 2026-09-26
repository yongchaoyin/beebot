# 2026-09-26 UI 合并前隔离验证

以已推送的 `b1eff1e4e359dc4f4d9eedbf6e163410fb803067` 为基线，在独立工作树
验证待合并到 develop/main 的提交。原工作区及其未提交改动保持原样；既有 Docker
连接修改不纳入本提交。本次不替换 `/Applications/BeeBot.app`。

## 必要修复

- 打包 renderer 的通知组件改为首次渲染时绑定 React。原 prefix 在后面的 `var S`
  赋值前创建组件，会永久捕获 undefined。回归执行真实 adapter 输出的初始化语句，
  使用真实 React SSR 验证通知正文及单 Bot/群聊共用组件；其余桌面启动被隔离。
- Host 附件摘要输出固定版 renderer 要求的 `{kind,count}[]`，避免 `.filter` 崩溃。
  回归直接把实际 Host 投影交给 pinned Yun/Zun/the，覆盖双方附件、批次、可见性、
  未知类型及普通文本/链接。附件、名称等测试数据均为本地 fixture。
- 可编辑前端同时接受数组和历史 Record，归一为既有视图格式；拒绝无效计数及
  原型保留键。真实 Host→真实前端 parser 回归覆盖用户/Bot、单聊/群聊列表与旧格式。

## 本轮已完成的验证

- Node 26.5.0，按锁文件 `npm ci --no-audit --no-fund`；bootstrap 校验固定运行时，
  两份 LFS 安装包保持清单中的原始大小和 SHA-256。
- 三个新回归文件合计 11 项通过；最终 `npm run check` 的两套类型检查通过，
  1269 项测试中 1254 通过、15 条件跳过、0 失败（97.98 秒）。跳过的是显式开关
  控制的真实 Host/Node/Docker 部署集成，不能作为在线模型或部署验收通过。
- `npm run frontend:build` 通过；保留既有混合静态/动态 import 提示。
- 在最终检查通过后执行 `node scripts/package-macos.mjs` 和 `npm run verify`，
  均通过；实际检查 14 个可执行源码运行时、ASAR 确定性、原生依赖、身份和签名。
  Node 原生依赖复用同仓库的 ABI 147 缓存，并在 Node 26.5.0 实际加载及解析验证。
- 所有生成包、下载缓存、日志、截图均留在忽略目录，不进入提交。

## 前置条件失败与边界

初次隔离配置曾误用 Node 24 且源载荷目录不正确，该次结果不计入有效验证。
随后 Node 26.5.0 首次全量仅因 Windows LFS 文件还是指针而失败；补齐原始内容并
校验后重跑。打包头文件下载阻塞后停止该次尝试，最终使用上述兼容缓存成功重跑。
这些尝试没有改变 engines、锁文件或断言。

本轮没有向真实用户 Bot 发消息或执行在线模型任务。此前双语阶段的 smoke
仍受现有纯源码 renderer provenance/路由证明前置条件限制，本轮未放宽或重跑
该门槛；当前发布路径明确是 pinned renderer 加 adapter。

## 原生窗口回归补齐

首次原生检查因 Electron 下载超时未运行；重试取得官方 Electron 42.1.0 后按
项目内置 SHA-256 验证完整 ZIP，再原样启动。原生页面实际暴露出测试夹具遗漏
双语 adapter 新增 helper 的错误（`BB_uiMemo is not defined`）。修复测试脚本，
复用真实语言 adapter bootstrap、React 和 compiler-runtime；仅语言持久化、
叶子控件回调及窗口状态输入为受控 fixture。没有修改正式语言逻辑或放宽几何断言。

最终真实 macOS BrowserWindow 回归 27 项通过、0 console errors：英→中→英更新
新建控件 aria-label，保留控件/输入节点及焦点；五档缩放的标题区与点击、最窄
窗口、真实全屏进出和草稿保留均通过。这是原生组件夹具验证，不是完整安装版
或真实服务器/模型集成验收。原有 15 项条件跳过仍按上文记录。
脚本变更后另外执行窗口布局、CI 前置条件与发布打包相关测试，19/19 通过、
0 跳过；语法及 diff 检查通过。

最终隔离包 ASAR SHA-256：
`9ea76a499b0db9b772cca57e6afc066a50b3951f115551b81380f0ad39535241`。
绿色图标 SHA-256：
`17923137c2a9afa9c55a25bcd2476bd18917d086ccac65a1308073b639aae07e`。
合并前仍需对最终 Git 提交执行 `npm run publication:check`，确保干净导出无丢失。
