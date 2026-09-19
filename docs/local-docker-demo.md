# 本机双节点 Docker 演示

这套环境用来验证 Mac 同时连接两个独立服务端。每个节点有自己的 Owner、Bot、数据卷和容器网络；默认保留数据，方便反复打开客户端体验。

表中的两个容器是 **Server 环境，不是两个 Bot 容器**。每台 Server 都能创建多个 Bot；表中列出的是自动验收脚本最初创建的示例 Bot。也可以在 Mac 主列表上方的“+ → New bot → 部署服务器”中选择 A 或 B，继续创建独立实例。

**模型是本地固定验收 fixture，不是通用 AI。** 提交目标后只执行环境检查：真实 Shell 在 Bot 的工作目录写入 `environment.txt`、`platform.txt`，并向 `runs.txt` 追加一次记录，再返回待验收结果。它不调用外部模型、不读取已有模型账号，也不理解任意自然语言任务。换成真实模型时，按[服务端部署说明](node-server.md)创建正式节点。

| 节点 | 容器 | Mac 连接地址 | Bot |
| --- | --- | --- | --- |
| A | `beebot-demo-a` | `http://127.0.0.1:17431` | Docker A 验收 Bot |
| B | `beebot-demo-b` | `http://127.0.0.1:17432` | Docker B 验收 Bot |

## 启动与验证

在仓库根目录执行，Docker Desktop 需要已启动：

```sh
docker build -f deploy/node.Dockerfile -t beebot-node:validation .
docker compose -f deploy/node-local-demo-compose.yml up -d
node scripts/verify-local-node-demo.mjs
```

验收脚本只操作这两个专用演示容器：创建独立随机账号、完成 PKCE 登录、创建 Bot、并行运行真实 Shell、检查令牌不能跨节点使用，然后暂时停止 A，确认 B 仍可执行新任务，最后恢复 A 并核对身份与文件。验证会在两个 Bot 内留下任务记录，不会清空数据。

本机账号信息保存在忽略目录 `.build/local-docker-demo/access.json`，文件权限为 `0600`。其中 `nodes.a` 和 `nodes.b` 分别包含用户名、随机密码和节点信息。不要将该文件提交到 Git 或公开。验收结果保存在同目录的 `verification.json`；验收脚本自己的临时设备会话会在结束时撤销。

在 Mac 的 **设置 → 服务器（Settings → Servers）** 分别添加两个地址，使用对应账号在系统浏览器授权。返回后，两个 Server 上的 Bot 都显示在左侧主列表中，副标题标明所属 Server。主列表上方 **+ → New bot** 用于选择 Server 并创建 Bot；点击某个 Bot 后进入原聊天位置；从底部输入框发送消息，回复与操作状态显示在对应对话中。测试客户端若带 `--use-mock-keychain` 启动，只用于本机演示；正式客户端应使用系统钥匙串，不能沿用该测试启动参数。

## 网络与持久化

每个容器里的 Node 仍只监听 `127.0.0.1:7331`。演示 supervisor 提供 TCP 转发 `7332 → 127.0.0.1:7331`，Docker 把转发端口仅映射到宿主的 `127.0.0.1`。HTTP 和 WebSocket 使用同一入口。模型 fixture 只监听容器回环，不发布 Host、工具执行器或模型端口。

两个容器分别连接自己的 bridge 网络，不共用网络和 Bot 数据卷。Docker Desktop 不会在仅有 `internal` 网络时实际发布端口，因此这里使用两张独立的普通桥接网络；容器可以出站联网，但本地验收模型不会请求外部服务。此转发器只适合本机演示；不要改成公网监听。云端继续使用 HTTPS 和正式的 `node-compose.yml`，生产服务端的 HTTP/TLS 校验没有为演示放宽。

容器使用非 root 用户，移除 Linux capabilities，限制资源；Bot 执行权限仍是该容器账号的权限，不等于已经实现公众多租户托管。

## 停止与恢复

```sh
docker compose -f deploy/node-local-demo-compose.yml ps
docker compose -f deploy/node-local-demo-compose.yml stop
docker compose -f deploy/node-local-demo-compose.yml start
```

停止和重新启动会保留账号、Bot、执行记录和工作目录。不要使用 `down --volumes`，它会删除这两个演示节点的数据。原有 Docker 容器不受这些命令影响。

目前验证的是两个节点独立执行、客户端统一连接管理；Bot 自动跨节点委派和故障接管仍未实现。停止 A 后由 B 继续执行的是 B 自己的新任务，不是自动接管 A 的工作。

## 已执行的验收

**Settings → Servers** 的最终安装包界面回归已完成：独立的已初始化 Mac 测试资料分别授权 A、B，设置页内直接显示服务器管理，侧栏底部入口已移除。A 在线并显示三个 Bot，B 在线并显示一个 Bot，用户已有“而为”保留。

CUA 控件树与截图不同步后，使用该临时实例的 CDP 完成真实 DOM 点击和输入验证：B 聊天六条历史消息、三个 `succeeded` 目标保持不变；打开关闭 Settings，以及原 + → New bot → 选择 B → 取消后，当前 Bot 和中文草稿保留。部署选项包含 This Mac、A、B，选择远端隐藏本机 API 配置。中文草稿通过 CDP Input 录入，再用 Backspace 清空；本轮未新增 Bot 或任务，未验证操作系统键盘输入。Settings、New bot 和远端聊天截图均已检查。两个临时设备会话已从服务端撤销，测试应用已恢复使用原隔离 profile。

该测试资料显式使用远端执行模式，没有创建本机 Docker 容器或使用真实模型密钥。原隔离 profile 缺少本机初始化配置，旧包同环境也进入模型配置页，原配置没有为测试而修改；本轮结果不代表纯远端首次启动引导已完成。

2026-09-19，在本机 Docker Desktop 的 Linux ARM64 环境执行通过：

- 两个节点健康，实际端口只发布到 `127.0.0.1:17431` 和 `127.0.0.1:17432`。
- 独立账号、Node ID、Bot ID、数据卷与网络；未授权请求以及跨节点使用的 access token 均返回 `401`。
- A、B 并行完成真实 Shell 验收目标，文件分别写入 `node-a` / `node-b`，平台为 `Linux`。
- 停止 A 时，B 完成第二个目标，且 `runs.txt` 恰好增加一行。
- 恢复 A 后，身份、文件、任务验收状态保持不变；两个节点均保留运行。
- 早期工作台表单曾创建“Docker A 第二 Bot”并验收真实 Shell；该数据保留。创建入口现已移回主列表 + 菜单中的 New bot。
- 在多 Bot 隔离验收时，A 承载两个 Bot，B 承载一个 Bot。只读基线比较确认 A 两个 Bot 的 Host 身份和实际工作目录不同，原 A Bot 与整个 B 节点的 Bot、任务和验收文件保持不变。报告保存在 `.build/local-docker-demo/multi-bot-verification.json`。

- 远端 Bot 已接回原聊天位置，复用现有标题、消息列表与输入框，移除三栏任务页。原生界面已确认聊天布局；另通过当前聊天控制器 → 真实 NodeConnectionManager → Docker B → 真实 Host/Shell 完成一次消息与验收，B 的 `runs.txt` 从 2 增至 3，原历史保留。报告 `.build/local-docker-demo/chat-controller-verification.json` 明确此运行未验证原生键盘输入。

可以只读复查当前多 Bot 状态：

```sh
node scripts/inspect-local-node-bots.mjs --expect-a 2 --expect-b 1
```

这条命令适用于 A 有两个 Bot、B 有一个 Bot 的基线；后续从客户端添加更多 Bot 时，应相应调整预期数量。刚运行自动初始化脚本时，A 和 B 各有一个示例 Bot。
