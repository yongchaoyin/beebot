# 独立 BeeBot 服务端与 Mac 客户端

当前交付是一套可信单所有者的服务端，以及现有 Mac 应用中的服务器管理与主 Bot 列表。一个客户端可以连接多个独立节点，在选定节点创建 Bot、提交任务、查看执行结果和确认交付。服务端单独运行；客户端退出不会停止任务。

**Server 与 Bot 不是一对一关系。** Server 提供运行环境和持久存储；一台 Server 可以承载多个 Bot，每个 Bot 有自己的身份、会话和工作目录。添加 Server 只建立连接，不自动创建 Bot。主列表上方 **+ → New bot（新建 Bot）** 中的“部署服务器”决定实例创建的位置；保留原头像、颜色和名称设置。本机沿用原创建流程，远端使用所选 Server 的模型配置。创建完成后，新 Bot 出现在左侧主列表，点击进入原有聊天区域。

当前实现的接口、状态与事件格式见 [Node protocol v1](node-protocol.md)。

想先在一台 Mac 上体验多个节点，可使用[本机双节点 Docker 演示](local-docker-demo.md)：两个独立容器和账号，使用本地验收模型执行真实 Shell，无需配置商业模型密钥。

本阶段尚未实现跨节点 Bot 自动协作、任务自动转移、多用户托管隔离、Windows/iOS/Android 客户端或控制面高可用。这里的多节点连接表示客户端可以管理多个服务器，不代表服务器已经组成自动调度集群。

## 1. 运行方式与信任边界

| 方式 | Node 与工具运行位置 | 客户端地址 |
| --- | --- | --- |
| Mac 本机开发 | 独立 Node 进程与该用户的宿主工具进程 | `http://127.0.0.1:7331` |
| Linux 云端直接部署 | 专用操作系统用户的 Node 与工具进程，Node 直接提供 TLS 或同机反代 | `https://bot.example.com` |
| Linux 容器部署示例 | 一个非 root 容器承载该所有者的控制服务与 Bot；Caddy 提供 TLS | `https://bot.example.com` |

Bot 有独立持久目录，但当前 Runtime 与控制服务同属一个可信部署，目录不是安全沙箱。Bot 执行命令时具有运行账户在该机器/容器内的文件与网络权限。容器示例也没有实现 Bot 之间或跨用户的隔离；不要将其作为公众多租户服务开放注册。

本轮已在本机 Docker 完成 Linux ARM64 镜像构建与非 root 容器验收：使用打包后的 CLI 初始化节点、创建所有者、完成 PKCE 登录、通过真实 Host 和 Shell 写文件、确认交付，并重启服务器验证身份与结果保留。测试模型是容器内的 HTTP 协议 fixture，容器禁用外部网络、未发布端口；这验证了服务端和工具链，不是商业模型效果测试。尚未验收 Linux x86_64、真实云服务器域名、Caddy 的 ACME 证书签发或图形工具能力。

## 2. 从源码启动本机节点

需要仓库声明的 Node.js `26.5.x`（`>=26.5.0 <27`）。在仓库根目录执行：

```sh
npm ci
node scripts/build-node.mjs
node .build/node/node/main.mjs init --data-dir "$HOME/.beebot-node"
```

独立构建输出位于 `.build/node`；构建入口不依赖 Electron 应用、macOS DMG 或固定版渲染器。服务端的 JavaScript 依赖仍从本仓库的 `node_modules` 解析；不要仅复制 `main.mjs` 到另一台机器。

`init` 只创建新的 `node.json`，已有文件会报错而不会覆盖。保持生成的 `nodeId` 不变，并在该文件增加模型配置。例如：

```json
{
  "version": 1,
  "nodeId": "保留 init 生成的 UUID",
  "name": "My BeeBot",
  "bindHost": "127.0.0.1",
  "port": 7331,
  "publicUrl": "http://127.0.0.1:7331",
  "maxConcurrentRuns": 2,
  "model": {
    "baseUrl": "https://your-model-provider.example/v1",
    "modelId": "your-model-id",
    "apiKeyEnv": "CUSTOM_API_KEY"
  }
}
```

模型地址、模型 ID 和凭据由你选择的服务商提供。这里使用兼容 OpenAI 的 HTTP 接口，不假定某个供应商、模型或 CLI 已登录。不配置模型时可以建立节点与账户，但不能把它当作已经可执行模型任务的服务。

通过当前终端或进程管理器的环境注入 `CUSTOM_API_KEY`。不要把密钥写进 `node.json`、Git、命令参数或客户端。Mac 的 zsh 可以使用隐藏输入：

```sh
read -s 'CUSTOM_API_KEY?Model API key: '
export CUSTOM_API_KEY
node .build/node/node/main.mjs start --data-dir "$HOME/.beebot-node"
```

本机启动不要求启动 Mac 应用。关闭这个服务端终端会影响进程；长期运行请使用操作系统服务管理器，或下文的容器服务。电脑睡眠、断电、网络断开仍会影响本机 Node。

## 3. 首次设置与客户端连接

1. 首次 `start` 在本机终端显示一次设置地址，有效期 10 分钟。在浏览器打开该地址，创建唯一的所有者账号。用户名为 3–64 个常见 ASCII 字符；密码至少 12 个字符。设置链接失效且尚未创建所有者时，重启 Node 会生成新链接。
2. 在 Mac 应用打开 **设置 → 服务器（Settings → Servers）**，添加 `publicUrl`，例如 `http://127.0.0.1:7331` 或 `https://bot.example.com`。远端 Bot 的模型与密钥配置在服务端。
3. 选择连接。系统浏览器显示节点、设备和权限；输入该节点所有者账号并确认授权。
4. 浏览器回到 Mac 本机临时回调地址；客户端获得自己的可撤销设备会话。节点地址和凭据属于此连接，不与其他服务器串用。
5. 返回主界面，在 **Bot 列表上方 + → New bot（与 New group chat 同一菜单）** 打开原创建页，选择“部署服务器”，设置头像、名称和职责；同一台服务器可以重复创建多个 Bot。创建成功后直接选中主列表中的新实例，在原聊天输入框发送消息；回复显示为聊天记录，可在回复下标记完成。
6. **Settings → Servers** 只负责连接、授权和查看服务器中的 Bot，不另设创建或任务表单。远端聊天复用现有消息列表、头像、标题与输入组件；Server 名称只作简短位置标识。当前 New group chat 仍由本机 Bot 组成；远端 Bot 不会混入本机群聊成员。

连接管理入口已移入设置，主侧栏底部不再放置独立入口。本次入口调整的原生界面验收尚未完成；首次启动引导到远端聊天的完整路径也尚待验证。

节点账号由自己的服务端管理，不需要 BeeBot 官方账号。模型密钥由执行服务器使用；账号密码只提交到授权浏览器页面，不发送给模型。

关闭客户端后，重新打开并连接同一节点即可读取服务器保留的 Bot、任务与结果。重复提交必须复用同一个幂等键；客户端不把一次超时解释为“服务器没有收到”。

## 4. 远程 HTTPS

`publicUrl` 必须是客户端可访问的完整 origin，不带路径、查询参数或账号密码。远程连接要求 HTTPS；HTTP 仅供明确的 loopback 场景。没有公共域名时，也可以先通过受控私有网络取得稳定的 HTTPS 地址。

**直接 TLS：** 在 `node.json` 中配置 `tls.certFile`、`tls.keyFile`，文件路径为服务器上的绝对路径，并设置 HTTPS 的 `publicUrl` 与对应监听端口。证书必须得到客户端操作系统信任；不要禁用 TLS 校验。

```json
{
  "bindHost": "0.0.0.0",
  "port": 7331,
  "publicUrl": "https://bot.example.com:7331",
  "tls": {
    "certFile": "/etc/beebot/tls/fullchain.pem",
    "keyFile": "/etc/beebot/tls/privkey.pem"
  }
}
```

以上是合并进现有 `node.json` 的字段，不是完整配置。私钥需仅允许服务账号读取；证书更新后重启当前 Node 进程。

**同机反代：** Node 绑定 `127.0.0.1`，由 Caddy 等服务在 443 端口终止 TLS。`publicUrl` 仍填写外部 HTTPS 地址。内部 Host RPC、执行器端口与 Node 的明文端口不应作为公网入口。

**容器反代：** 由于反代与 Node 位于不同容器，显式设置 `tlsTermination: "trusted-proxy"`，允许 Node 监听容器网络地址。该选项只是部署声明，不会自己提供加密；只有 HTTPS 反代可以触达内部端口时才使用。下面的 Compose 不把 7331 发布到宿主。

## 5. Docker Compose 示例

文件：[Dockerfile](../deploy/node.Dockerfile)、[Compose](../deploy/node-compose.yml)、[Caddyfile](../deploy/node.Caddyfile)。Dockerfile 附带独立的构建上下文排除文件，只传入源码、脚本和依赖清单，不把本地凭据、数据目录、缓存或桌面构建载荷送入镜像构建。

镜像以 Node.js 26.5.0 为基础，为 Linux 当前架构编译 `tree-sitter` 绑定；构建阶段需要联网下载镜像与 npm/系统依赖。运行镜像包含 Node、Python、Git、curl 和 shell，不包含图形桌面、浏览器驱动或第三方模型 CLI。需要的额外工具应由运维人员维护派生镜像，不由模型临时提升容器权限。

可以先在本机复现容器验收；以下步骤只使用临时容器数据和本地模型 fixture，不读取模型密钥、不部署公网服务：

```sh
docker build -f deploy/node.Dockerfile -t beebot-node:validation .
docker run --rm --init --network none --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 512 --memory 4g --cpus 2 \
  --mount "type=bind,src=$PWD/scripts/smoke-node-service.mjs,dst=/smoke.mjs,readonly" \
  --entrypoint node beebot-node:validation \
  /smoke.mjs /app/.build/node/node/main.mjs
```

成功时脚本输出平台、非 root UID、PKCE、实际 Shell 和重启验证结果。已安装依赖并完成独立构建的 Mac 也可运行 `node scripts/smoke-node-service.mjs` 做同样的 CLI 验收。

准备一台 Linux 服务器、Docker Compose、域名以及指向该服务器的 DNS。允许公网访问 80/443，Caddy 会使用域名办理 TLS。模型接口与工具需要向外联网。Compose 中只有 Caddy 发布端口；Node 的内部网络通信与模型出站网络分别声明。[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[Compose 网络说明](https://docs.docker.com/reference/compose-file/networks/)

从仓库根目录执行，域名填写自己的真实值：

```sh
export BEEBOT_DOMAIN=bot.example.com
docker compose -f deploy/node-compose.yml build node
docker compose -f deploy/node-compose.yml run --rm --no-deps node init --data-dir /var/lib/beebot-node
```

先生成的配置保存在 `node_data` 命名卷。可以用临时管理进程修改配置，同时保留 nodeId；以下命令从标准输入读取脚本，不把密钥写入卷：

```sh
docker compose -f deploy/node-compose.yml run --rm --no-deps -T \
  --entrypoint node -e BEEBOT_DOMAIN="$BEEBOT_DOMAIN" node --input-type=module - <<'NODE'
import fs from 'node:fs';
const file = '/var/lib/beebot-node/node.json';
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
config.name = 'My Cloud BeeBot';
config.bindHost = '0.0.0.0';
config.publicUrl = `https://${process.env.BEEBOT_DOMAIN}`;
config.tlsTermination = 'trusted-proxy';
config.model = {
  baseUrl: 'https://your-model-provider.example/v1',
  modelId: 'your-model-id',
  apiKeyEnv: 'CUSTOM_API_KEY'
};
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
NODE
```

执行前把模型地址和模型 ID 改为自己的配置。然后通过服务器安全的环境注入方式提供 `CUSTOM_API_KEY`，再启动：

```sh
docker compose -f deploy/node-compose.yml config --quiet
docker compose -f deploy/node-compose.yml up -d
docker compose -f deploy/node-compose.yml logs node
```

不要直接运行未带 `--quiet` 的 `docker compose config` 并公开输出，因为展开后的配置可能包含环境密钥。首次节点日志含一次性设置地址，只在可信终端查看，不发布日志。Caddy 示例未开启访问日志，避免把设置码与 OAuth 授权码记入请求日志；调整代理日志时应保留这一规则。

打开日志里的 HTTPS 设置地址并创建账号，然后在 Mac 客户端的 **Settings → Servers** 添加 `https://bot.example.com`。`/health` 只能证明控制服务健康，不代表模型密钥有效、任务完成或机器具备图形工具能力。

Compose 的 4 GiB 内存、2 CPU 和并发 2 是起始资源约束，需按模型客户端与实际工具负载调整。使用 `docker compose stop` 停止；不要使用 `down --volumes` 清除包含 Bot 与账号的持久卷。

## 6. 认证与数据存储

客户端使用 Authorization Code + PKCE S256；公开 `client_id` 为 `beebot-desktop`，回调仅允许 `http://127.0.0.1:<临时端口>/oauth/callback`。访问令牌不放在 URL 中；事件通道使用首帧提交的一次性票据。

| 项目 | 当前约定 |
| --- | --- |
| 设置码 | 10 分钟、一次性；只在 Node 的本机启动输出展示 |
| 授权码 | 60 秒、一次性，绑定回调 URI 与 PKCE |
| Access token | 10 分钟；服务端保存摘要 |
| Refresh token | 每次刷新旋转；30 天闲置、90 天绝对期限 |
| 重放与退出 | 旧 refresh 重放或撤销会终止对应设备会话，不影响其他设备 |
| 事件票据 | 30 秒、一次性；长连接持续检查会话是否撤销 |
| 账号密码 | Node 内置 scrypt，`N=2^17, r=8, p=1`，随机盐；单次约 128 MiB，最多两次并发派生 |

选择内置 scrypt 避免额外密码哈希原生依赖；其成本参数和请求限流共同限制在线尝试。登录页面不加载第三方脚本，具有 CSRF 校验、Origin 限制、CSP 和禁止缓存策略。[PKCE 标准](https://www.rfc-editor.org/rfc/rfc7636)、[原生应用 OAuth](https://www.rfc-editor.org/rfc/rfc8252)、[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

认证页面使用 `Referrer-Policy: same-origin`：保留同源表单 POST 的有效 Origin，同时不向跨 origin 的本机 OAuth 回调发送 Referer。不能改成 `no-referrer` 后再放宽 `Origin: null` 校验；Chromium 原生表单会因此改变 Origin，导致严格 CSRF 检查拒绝正常登录。

数据目录至少包含：

```text
node.json                    节点身份、地址与模型引用
auth.sqlite                  Owner 与设备会话
control.sqlite               Bot、任务、运行、幂等记录与事件
controller-lock.sqlite       单写进程锁
runtime-bots/<内部标识>/      Bot 的持久 Host 数据、工作目录、运行回执与日志
```

SQLite 使用本机磁盘。不要把同一份运行中的数据库放到网络共享盘供多个节点同时写入，也不要用同一 data-dir 同时启动两个服务器。多个实例使用不同目录、端口和节点 ID。

## 7. 中断、取消、备份与升级

节点重启时，原来的运行中任务会保守地进入“结果待核验”；服务端不会自动再次发送可能已产生副作用的指令。失联不代表邮件未发送或外部提交未生效。当前没有自动把工作迁移到另一节点的承诺。

对未核验执行保留 Bot 栅栏。先检查该 Bot 的日志、工作目录和相关外部系统，再在客户端填写核查说明、确认已经核验，选择“核查后恢复 Bot”。服务端检查旧执行已经停止，归档恢复记录后允许该 Bot 接收新目标；旧目标标记为失败并保留记录，不自动重跑。若旧进程仍在运行，继续保持阻断。

人工核验不是自动回滚，也不能证明所有第三方效果已消除；说明必须反映实际检查结果。不要手工删除回执或修改数据库绕过核验，新建 Bot 也不能证明旧执行的副作用已经消失。

取消阻止继续执行，但不会回滚已写文件或第三方动作。模型交付结果进入待验收状态；确认验收与模型结束一轮对话是不同事实。

备份采用停机方式：先确认没有进行中的任务，再停止服务端，保留完整 data-dir（包括所有 SQLite 相关文件与 Bot 工作数据），存放到仅管理员可访问的加密备份位置。容器部署另外保留 Caddy 的 `caddy_data` 与 `caddy_config` 卷。模型密钥应通过其原有秘密管理方式备份，不写回节点配置。

恢复时必须先停止并隔离旧服务器，再在单一新位置恢复同一份数据与 Node 身份。不能把快照当作一份可同时在线的克隆。备份后的未落盘工作不会凭空恢复；外部副作用仍需核验。

升级前停机备份，再重建同版本仓库的服务端与 Mac 包，保留 data-dir 和 nodeId。当前没有自动跨版本数据库迁移、自动回滚或 HA 切换机制，升级验证应使用备份副本与隔离环境先完成。

## 8. 手动运行真实浏览器认证回归

HTTP 单测不会自动复现浏览器的 Origin、Referrer 与 CSP 行为。Mac 开发环境已准备仓库 `.cache/runtime/Grok Bot.app` 时，可运行：

```sh
node --test tests/node-auth.test.mjs
node tests/node-auth-browser.integration.mjs
```

第二条命令创建独立临时账号、NodeAuth 服务、loopback 回调和临时 Electron 应用副本；不使用现有客户端或用户浏览器 profile。BrowserWindow 全程隐藏，禁用应用激活，保留 sandbox、contextIsolation 和 webSecurity；通过真实 HTML 表单提交验证 `303 → callback 200 → PKCE 200`，并确认跨 origin 回调没有 Referer。它会重新计算测试 ASAR 的完整性元数据，并只为临时应用进行开发签名，不修改仓库缓存 runtime。

每个自建子进程有 30 秒硬超时，浏览器内部有 25 秒截止时间；结束后删除临时测试数据。此测试验证 Chromium 引擎与应用认证策略，不代替安装后的 Mac 客户端和系统浏览器人工验收，也不加入默认 `npm test`，避免普通单元测试启动浏览器引擎。
