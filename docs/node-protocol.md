# Node protocol v1：当前实现

本协议用于首轮 Mac 客户端与可信单 Owner Node；不包含尚未实现的跨节点 Bot 委派。实现入口为 `source/node/server.ts`、`auth.ts` 与 `control-store.ts`。部署与登录操作见[运行说明](node-server.md)。

## 地址、身份与连接

客户端保存服务器 origin、`nodeId` 和本机连接 ID。远端使用 HTTPS；仅 loopback 允许 HTTP。重定向不会自动携带凭据。使用已保存凭据之前核验 Node 身份，服务器重装后需要移除旧连接并重新添加。

`GET /v1/node` 无需认证，返回 `{id, nodeId, name, protocolVersion: 1}`，其中 `id === nodeId`。`GET /health` 返回 `{ok, protocolVersion}`，控制账本失败时 HTTP 503；不包含模型凭据或内部 Host 地址。

用户认证采用 `/.well-known/oauth-authorization-server`、`/oauth/authorize`、`/oauth/token`、`/oauth/revoke`，参数为标准 OAuth 表单。公开客户端 `beebot-desktop` 使用 PKCE S256，浏览器回调严格为 `http://127.0.0.1:<临时端口>/oauth/callback`。首次 Owner 设置使用 Node 启动输出的一次性 `/setup?code=...`。

业务 API 使用 `Authorization: Bearer <access_token>`，请求 JSON。API 与事件端点不接受浏览器 Origin；Mac 由可信 Electron 主进程发起请求，renderer 只通过受限 IPC 操作。OAuth 的浏览器页面有独立 CSRF/Origin 校验，不受这条原生 API 限制。

## 业务请求

| 方法与路径 | 输入 | 响应 |
| --- | --- | --- |
| `GET /v1/snapshot` | 无 | `{node, bots, goals, cursor}` |
| `POST /v1/bots` | `{name, description, avatarColor?, avatarShape?}` | 201 `{bot}` |
| `POST /v1/goals` | `{botId, prompt}` | 202 `{commandId, goalId}` |
| `GET /v1/goals/:id` | 无 | `{goal, task, transcript}` |
| `POST /v1/goals/:id/cancel` | `{}` | `{goal}` |
| `POST /v1/goals/:id/accept` | `{expectedVersion}` | `{goal}` |
| `POST /v1/goals/:id/reconcile` | `{expectedVersion, note}` | `{goal}` |
| `POST /v1/events/ticket` | `{}` | `{ticket}` |

除事件票据和 OAuth 外，所有业务写请求要求 `Idempotency-Key`：8–128 个字母、数字、下划线、点、冒号或连字符。键按 Owner 隔离；相同键与输入返回原响应，不同输入返回 409。响应丢失时以相同键查询/重发，不能换键假定此前请求未到达。

`commandId` 当前仅用于接收回执；通过 `goalId` 查询进展，尚未提供独立命令状态端点。客户端工作台保留当前窗口中未获确认的请求键，尚不支持客户端进程崩溃后自动恢复未确认的提交；重启后先检查服务器目标列表。

可选头像字段与原 Mac 创建页一致：`avatarColor` 为 `black, brown, red, orange, yellow, green, cyan, blue, violet, magenta, gray`；`avatarShape` 为 `blob, pebble, squircle, tablet, wedge, hex, cloud, teardrop`。未传时保留原默认行为；旧记录不改写。旧服务端会拒绝新字段，客户端与服务端应一起升级，不通过丢弃头像后重试来掩盖版本不一致。

Bot 名称最多 100 字符，描述最多 8000 字符；目标文本最多 64000 字符，JSON 请求体最多 128 KiB。当前 Mac 界面的文本上限更小。人工核查说明为 8–4000 字符。未知字段拒绝，业务错误为 `{error: code, message}`；OAuth 错误使用 `error_description`。

## 对象与状态

- `Bot`：`id, name, description, avatarColor?, avatarShape?, ownerId, createdAt`。每个 Bot 在该节点拥有独立持久身份和工作目录。
- `Goal`：`id, botId, ownerId, taskId, prompt, status, result, error, createdAt, updatedAt, version`。时间为 Unix 毫秒，`result/error` 可为空。
- `Task`：`id, goalId, botId, status, currentRunId`。当前一个 Goal 对应一个 Task；不是完整 DAG 调度协议。
- `Run`：服务端记录的执行尝试，包含 `id, taskId, status, startedAt, finishedAt`。同一 Run 永不自动重复发送给模型。
- `transcript`：当前尝试的 Host 记录数组；文本消息附带 `role/text`。工具记录仍保留 Host 原始结构，不作为其他客户端的稳定工具 schema。

正常过程为 `queued → running → review → succeeded`。`review` 表示已有执行结果，`accept` 需要匹配 `expectedVersion`，避免在旧界面上验收已变化的内容。

取消排队任务直接成为 `cancelled`。执行中的任务先进入 `cancelling`，随后确认停止；无法证明外部副作用时进入 `uncertain`。取消与自然完成相遇时，已确认的结果仍可进入 `review`，不会被静默抹去。

明确的执行失败为 `failed`。服务端重启时原 `running/cancelling` 进入 `uncertain`；同 Bot 的后续任务阻断，其他 Bot 可继续。Owner 实际核查后提交 `reconcile`，服务端确认旧运行停止、退役自动唤醒标记、记录核查说明，将旧 Goal 关闭为 `failed`。Bot 身份保留，新目标生成新 Run，旧 Run 的未知结果不被改写为成功。

## 事件恢复

客户端先取一致快照，再申请 30 秒一次性票据并打开 `/v1/events` 的 WSS（本机 HTTP 对应 WS）。5 秒内发送第一帧：

```json
{"ticket":"opaque-ticket","after":42}
```

之后该连接仅用于服务端事件；不在 URL 放访问令牌。事件格式为 `{seq, type, data, at}`，目前包括 `bot.created`、`goal.created`、`goal.updated`。顺序号来自持久账本，提交命令、更新状态与追加事件属于同一 SQLite 事务。

服务端重放游标之后的事件并发送 `{type:"ready", cursor}`。落后超过一次重放批次（256 条）时返回 `{type:"resync", cursor}`；客户端重新读取完整快照。游标超出该节点账本时返回 `reset`，同样重新取快照。客户端将事件作为快照失效通知，不把不完整事件缓存当作权威数据库。

连接每 10 秒检查会话与 ping/pong，撤销后也会在下一次事件推送时检查；票据不能复用。慢消费者超过发送缓冲上限会被断开，重连时恢复快照与游标。客户端关闭事件连接不会取消服务器工作。
