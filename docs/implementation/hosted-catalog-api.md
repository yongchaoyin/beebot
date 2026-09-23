# 托管账号与空间 HTTP API（第二阶段）

基线：`9f619a7d0704e56f890352ce286cffdb0c360d63`，沿 PR #13 继续；
不修改其他产品分支，不引入客户端 SSH/安装，不合并到 develop。

## 已完成与严格边界

新增 `HostedCatalogServer`，从 `.build/node/hosting/index.mjs` 导出。
它是**可启动、可通过真实 HTTP 登录和访问的存储型服务端**，不是完整的
可收费出租产品。一个入口下可以有多个预创建账号，每个账号拥有独立的
密码校验、设备批准、恢复码和空间成员关系；认证、API 和加密存储实际相连，
不再依靠测试身份回调完成 HTTP 鉴权。

只允许创建/读取 Bot 记录、查询自己的空间和事件、管理本账号的设备。
没有 ControlService、Host 或 Shell 实例。提交任务返回
`503 tenant_execution_unavailable`，不接受、不入队、不扣费、不生成假结果。
没有公众注册、支付、邀请链接、客户自助密码设置/重置、SSO、生产 KMS、
虚拟机沙箱、完整 Group、附件/工作目录保护或客户端空间选择界面。
不可因为该 API 能创建 Bot 就开放出租或宣称完成多租户执行隔离。

## 复用认证，不重写设备安全

`NodeAuth` 增加显式 `accountMode: "invited"`；默认仍为 `"single-owner"`。
模式在账号库持久保存，已有单所有者库不会自动变成多人账号库，反向打开也拒绝。
旧账号、旧设备协议和普通 Node 的启动入口保持不变。

托管库的 `owner` 是为了复用既有外键而保留的历史表名：在 invited 模式内，
每一行代表独立账号，不代表平台所有者。用户名在开户与登录时统一 trim/lowercase，
具有唯一索引；每个账号有随机稳定 principal。未知用户名仍执行同成本 scrypt，
返回与错误密码一致的错误，但不宣称实现了精确恒定的 HTTP 响应时间。

继续使用系统浏览器授权码、S256 PKCE、DPoP、防重放、刷新轮换、可信设备批准、
恢复和实时 grant。**托管授权 scope 是 `account:workspaces`**，不是
`owner:node`。设备上的 admin 是账号设备管理权，绝不是平台管理权。
第一台设备仍需该账号密码、恢复码与明确确认；没有“最先登录就成为管理员”的路径。
恢复只影响该账号设备，不影响其他客户或删除工作空间。

公众 `/setup` 被禁止。`provisionInvitedAccount` 是可信运营组件的进程内 API，
不映射 HTTP、renderer 或 Agent 工具。调用方提供账号和初始密码，并通过
**同步、可失败的持久化回调**保存恢复材料；保存失败回滚账号与恢复记录。
回调返回 Promise 被拒绝，不能把未完成的持久化误报成功。回调已写出的外部副本
不受 SQLite 回滚控制，运营组件必须安全处理未提交的材料；不记录到日志或聊天。
已有用户名不会被重复开户覆盖。此接口并不是已完成的用户邀请产品流程。

`provisionWorkspace` 是另一个仅供可信运营组件的接口，要求目标账号已存在，
复用上一阶段可恢复的加密空间预留/激活。同一创建请求重试保持原空间和密钥。
两阶段之间失败时可重新准备空间，不重建账号、不替换恢复码或数据密钥。
不自动给从 HTTP 传入的身份创建空间，也不接受未认证的 tenantId 作为授权。

## 路由与客户端边界

公开身份：`GET /health`、`GET /v1/node` 和原有 OAuth 元数据/授权端点。
`/v1/node` 返回 protocolVersion=2、hostingProtocolVersion=1、
mode=hosted-catalog、eventTransport=poll、execution=unavailable。
这是显式的实验托管协议，不伪装成已支持空间隔离的普通 Node v1。
现有桌面连接器尚未适配，必须拒绝不兼容版本，不能退回旧快照或事件协议。

认证后的 API：

| 请求 | 返回/行为 |
| --- | --- |
| GET /v1/workspaces?after=UUID | 仅当前账号的有效成员空间；分页 ID、角色、成员版本，不是全平台目录 |
| GET /v1/workspaces/:id | 经授权解密的空间名称、ID 和执行不可用状态 |
| GET /v1/workspaces/:id/snapshot | 设备权限范围内的 Bot 记录及本空间游标 |
| GET /v1/workspaces/:id/bots/:botId | 仅本空间且设备获授权的 Bot |
| POST /v1/workspaces/:id/bots | 需 Idempotency-Key，写入原有加密 ControlStore |
| GET /v1/workspaces/:id/events?after=N | 有界 HTTP 事件续读，不是 WebSocket/SSE；只包含已授权业务事件 |
| POST /v1/workspaces/:id/goals | 验证对象与授权后明确拒绝执行，无接收副作用 |
| GET /v1/security/sessions | 仅本账号的设备/申请/会话，需当前管理员设备 |
| POST /v1/security/requests/:id/approve 或 deny | 本账号管理员核对申请版本和设备公钥后批准/拒绝 |
| POST /v1/security/devices/:jkt/block | 本账号设备封禁，仍保护最后一个管理员 |

当前 HTTP 批准支持明确的 wildcard Bot 范围与 admin/operator/viewer 角色，
尚不提供跨空间按 Bot 多选批准；已有底层具体 Bot grant 的交集检查没有取消。
租户成员管理仍为可信控制平面 API，没有公开成员提权、租户创建、生命周期、
账号枚举或密钥接口。不将默认 owner 身份作为平台管理凭据。

## 请求与生命周期防护

DPoP proof 对每个请求只验证一次；创建不可序列化的空间 scope 后，正文读取、
异步解密和返回结果之前继续检查实时会话、成员版本及空间状态。
同一个浏览器或设备切换账号不会复用上一个账号的 scope。
URL 中空间 ID 只是目标选择；X-Tenant-ID/X-User-ID/X-Account-ID 被拒绝，
不能通过正文 ownerId、tenantId 或 query token 覆盖服务端身份。

限定配置 origin 和 Host，不信任转发头修改发行者。默认 TLS 1.3；测试使用
回环 HTTP；可信代理必须按原配置显式设置并传递正确 Host。
必须启用平台外层 TLS、网络访问控制和请求速率策略，应用内并发上限不是完整防 DDoS。

路径不接受规范化后指向另一对象的形式；查询参数有 allowlist、重复/超大游标
校验。JSON 请求最多 32 KiB、读取截止十秒；拒绝压缩体、非法 UTF-8、重复成员
（包括转义写法）、深层对象和额外身份字段。受保护 API 不接受浏览器 Origin。
响应 no-store；不暴露原始数据库、密钥服务异常或请求内容。账号认证页继续使用
原来的独立 CSRF/CSP/表单大小与速率规则，不把账号密码发送给 renderer。

最多 32 个并发业务请求，同一账号最多 4 个，超额返回 429/Retry-After。
这是初始保护性限制，不是完整的套餐、按租户公平调度或带宽预算。
客户端断开会使当前请求的读取器失效；异步获取密钥完成后不能继续写入。
共享的密钥打开任务不会因某一个客户端取消就中断另一个合法读取者。

每个托管根目录有 SQLite 独占控制锁，重启由操作系统释放，不按 PID 猜测删除。
持久身份标记固定 nodeId/issuer，变更需显式迁移。拒绝就地接管旧 Node 目录。
安装器、客户端、旧 Node 的配置不会因此被改写。

## 加密保护不是运营者不可读

沿用独立 tenant DEK、记录认证加密、空间/对象绑定及密钥租约。
当前覆盖业务 JSON 和目录名称，不包含全部文件系统、浏览器、日志与模型调用。
用户名、账号索引、成员角色和操作元数据仍可能是明文；密码存储为 scrypt 派生值，
恢复码和令牌存储为摘要，不是以“给身份数据加密”代替认证设计。

LocalTenantKeyWrapper 仍是测试/受控部署参考，生产 KMS 尚未接入；进程处理时
可见明文，不声称对宿主运营者不可读、硬件密钥保护或端到端零知识。

## 验证与后续

`tests/tenant-catalog-server.test.mjs` 使用同一实际 HTTP 服务的两个账号，
通过真实口令校验、CSRF、PKCE、独立 DPoP 测试签名器、可信设备和 SQLite 登录。
运营侧开户回调把恢复码留在测试内存；测试 KeyWrapper 是受控夹具。
没有将真实浏览器 UI、系统 Keychain、公网证书、真实 KMS、虚拟机或模型伪装成已验收。

新增测试覆盖 A/B 空间/Bot/事件/幂等与重启、错误密钥和重放、跨账号设备批准、
恢复隔离、成员/设备交集、正文期间撤权、解密期间暂停、取消后的写入拒绝、
配额隔离、分页、输入校验、持久化回滚、模式隔离和根目录锁。
原认证/设备/消息/加密用例不删除，不更改依赖锁或放宽断言。

下一步：用户自己完成的邀请开户/恢复与运营入口、客户端按账号和空间隔离缓存、
生产密钥服务、实际租户执行沙箱，然后才开放任务与同租户 Group。
尚未接受或执行工作，不能用本阶段的存储 API 替代执行平面的验收。

参考：
- https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- https://www.rfc-editor.org/rfc/rfc9449.html
