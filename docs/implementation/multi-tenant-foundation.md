# 多租户数据基础：第一阶段，不是可出租的完整服务

基线：`feat/server-connection-20260923` / `d6dd284822cf78afd15736221da141635e7496f5`。
本阶段采用最新安全与连接代码，不合并客户端 SSH/安装预览，不修改认证、
客户端、Group、主分支或其他功能分支。新增目录为 `source/hosting/`。

## 产品与发布边界

目标是独立客户拥有自己的空间、Bot、Group、记忆和执行环境。客户端只连接
服务，不负责安装服务器。空间是隔离单位，Bot 与 Group 仍是平等的重要产品
入口；同租户协作不意味着跨租户共享。

本阶段交付内部控制平面的**授权与加密存储 API**，不是注册、支付或运行平台：
- 已实现空间预留/激活/暂停、成员角色、实时会话授权、独立 Bot 记录与事件。
- 已将加密接入原 ControlStore 和 TaskSecurityLedger，不复制另一套任务协议。
- 新 API 的任务提交明确失败，且不会接收/排队/执行。原 ControlService 也拒绝
  连接租户加密存储，避免误用共享单所有者运行器。
- 现有 Node 默认的单所有者认证、普通数据库与业务入口保持原语义。不会自动
  迁移、加密现有客户数据，不会把一个旧账号自动升级为平台管理员。
- 没有新的公开 HTTP 注册/租户路由，没有客户端空间切换，没有多用户 SSO，
  没有租户沙箱、远端 Group、KMS 产品集成、附件/向量索引加密、计量或支付。
  因而**不得开放公众多租户 Shell 或宣称现在已经能收费出租**。

## 代码边界与复用

`tenant-directory.ts` 保存空间与成员元数据；`tenant-workspaces.ts` 是必须带
授权范围的业务入口；`tenant-crypto.ts` 实现信封加密；`record-codec.ts` 是
现有存储的显式编码边界。`node:build` 另外导出
`.build/node/hosting/index.mjs`，不改变普通 Node 的启动和发现协议。

`nodeTenantIdentity(auth, configuredIssuer, identity)` 复用当前 NodeAuth：
`identity` 必须来自 `auth.authenticate(req)`；回调每次调用 `auth.grant`
重新验证设备会话，返回的 issuer 必须来自服务配置。它不是新的登录系统，
也不把单所有者 NodeAuth 自动变成多人账号。

未来共享身份层可以提供同一 `ReadTenantIdentity` 接口，但必须验证发行者、
签名、受众、设备和当前授权，不能直接使用请求正文/请求头里的用户或租户 ID。

## 当前授权机制

身份使用 `(issuer, subject)` 组合，不能仅凭不同身份源里碰巧相同的 subject
关联账号。发行者来自服务端固定允许列表。

`scope(reader, tenantId)` 先验证当前身份与成员关系，再返回不可伪造的进程内
句柄。业务方法不会信任普通 `{tenantId}` 对象、复制的句柄或其他目录实例的
句柄。句柄不是凭据，不能序列化给浏览器或队列。

每次业务访问与异步密钥获取之后都重查身份、租户状态和成员版本；读取已缓存
数据库不跳过授权。成员变更使旧句柄失效；更换账号、设备撤销和租户暂停后，
旧句柄不能继续读写。成员角色 owner/editor/viewer 与当前设备 grant 取交集，
设备 Bot 范围不会被空间 owner 身份覆盖。最后一个 owner 不可被移除或降级。

成员管理要求当前空间 owner 和完整管理员设备权限。`provision`、
`activateProvisioned`、`setStatus`、`inspect`、`protectedKey` 是可信控制平面
的管理接口，**不直接暴露给租户 HTTP/renderer/Agent**。平台管理员与租户
管理员的公开路由授权仍属于下一阶段，不要误把 deviceRole=admin 当作平台管理权。

每个租户使用服务器生成的 UUID 对应独立目录和 SQLite 文件。业务 ownerId
在这个内部 API 中是空间 ID，不是其他 Node 的用户 ID。不同成员的幂等键
还包含经过验证的 principal 作用域；同一客户重试返回原回执，另一客户或另一
成员使用相同字符串不会读取前者结果。

事件游标属于各自数据库。受限设备只能看到获授权 Bot 的业务事件；平台审计、
其他空间的消息、设备信息不进入这些事件。这里只提供读取 API，尚未接新的
多租户 WebSocket 路由或持久作业队列。

## 加密格式

使用 Node 内置 AES-256-GCM（12 字节随机 nonce、16 字节认证标签），不自研算法。
每个租户生成独立随机 256 位数据密钥 DEK；DEK 通过 TenantKeyWrapper 包装后
持久化。包装上下文绑定 tenantId、keyId 与用途，记录的附加认证数据绑定
格式、租户、密钥版本、表/对象类型与对象地址。事件额外绑定序号、类型与时间；
冻结记录绑定可查询的主体/范围/目标/活动状态。

业务 JSON 在写入 SQLite 之前加密，覆盖：
Bot、Goal、Task、Run、Transcript、人工核查 Decision、幂等 response、
Event、任务来源授权和冻结记录。查询使用解密后的值，不能对密文直接
`json_extract`。幂等内容摘要使用域分离的 HMAC 密钥，避免留下可猜测的正文
散列。空间显示名称也加密，目录不保存明文名称或未加密的名称摘要。

SQLite 主文件、WAL、备份里，这些业务字段都是密文；表名、行号、时间、
空间/对象标识、部分安全索引与成员角色等操作元数据仍可能是明文。这不是
全盘透明加密，也不覆盖当前 Host 工作目录、浏览器资料、模型凭据、日志、
附件或外部服务。不得将测试的控制库扫描说成所有数据副本都已加密。

加密数据库使用 user_version=3 和经过认证的绑定探针。空数据库也校验密钥，
错误租户/错误密钥/密文篡改/明文回退全部失败。旧格式数据库不会被就地转换，
旧单所有者读取器不能将租户密文当普通 JSON 使用。初始化与元数据写入在事务
内完成；回执加密失败会回滚对应投影和事件。现有冻结、验收、恢复、单写锁与
未知结果不重放的规则保持不变。

## 密钥与存储生命周期

`LocalTenantKeyWrapper` 是测试及受控部署的参考适配器。它要求调用方注入一把
32 字节 KEK，不自己创建、落盘或从用户密码派生。KEK 不得与业务目录和备份
一起保存，不得出现在客户端、Agent、日志、Git、命令参数或截图中。

它不是云 KMS/HSM，也不提供防宿主管理员读取能力。取得 KEK、服务进程权限
或正在使用的明文密钥仍可能读数据；内存擦除只是尽力清理，无法证明 JavaScript
运行时从未复制过明文。不得宣传运营者不可读或端到端零知识。

密钥服务调用有十秒截止时间，支持取消；不配合取消的服务后来返回的密钥也
会被丢弃并清理。数据密钥只在打开的 cell 中保留，最长六十秒租约，过期关闭
存储并清理密钥，下次访问重新 unwrap。KMS 撤权不保证已发出的租约立即失效：
需紧急阻断时先暂停空间；进程内暂停会驱逐缓存，下一次访问重新校验持久状态。
实际任务冻结/停止还需后续执行平面实现，不能把暂停数据访问说成已撤销外部动作。

同一进程最多打开 32 个 cell，可主动 release；不同请求打开同一 cell 时合并
正在进行的加载。关闭入口会取消未完成的密钥调用。默认每空间最多 100 个 Bot；
容量检查与幂等回执同一事务，达到上限仍允许读取已确认的原回执。这只是保护性
资源限制，不是完整套餐、用量或跨租户计算公平调度。

预留空间先持久化同一份包装密钥与创建回执，再初始化控制库并激活。中途失败
保留 provisioning 状态，可重试，不能换一把新密钥“修复”。密钥轮换、重新包装、
离线旧数据迁移、备份销毁与外部审计尚未实现；不要手工删库或重置密钥。
文件系统的 0700/0600 保护面向可信服务账户，不替代防恶意代码的执行沙箱。

## 验证与下一阶段

新增测试使用实际 Node crypto、SQLite、WAL、事务和被修改的业务模块；A/B 的
身份回调是明确的测试夹具，NodeAuth adapter 有单独的实时 grant 检查回归。
这些不是多用户真实登录、真实 KMS、真实虚拟机或公网集成验收。业务加密测试
会直接调用 ControlStore 的生命周期方法以验证存储，这不表示 hosted 入口
允许执行。

验证命令：
```sh
node --test tests/tenant-encrypted-store.test.mjs tests/tenant-workspaces.test.mjs
npm run source:typecheck
npm run check
npm run node:build
```
现有单所有者控制/安全测试继续保留。所有宽泛本地运行失败与资源限制记录到
交付证据，不以缩小测试范围或放宽断言伪装成全量通过。远端精确源码 CI 和
真实 Host/Shell 测试必须单独报告，不能累加重复测试。

下一阶段按顺序接：
1. 共享用户认证与邀请制、多租户 HTTP/事件路由，重用设备绑定与批准，不把
   客户端 tenantId 当凭据。客户端缓存、草稿和回执按空间隔离。
2. 真正隔离的执行单元、凭据代理、网络与存储挂载策略，经验证后才允许接受任务。
3. 同空间远端单聊与 Group、引用协作、附件/记忆/检索/日志的完整数据保护。
4. 计量、配额、恢复、销户与运营授权。公众开放前做跨租户攻击与故障恢复验收。

参考：Node crypto、OWASP Multi Tenant Security、OWASP Cryptographic Storage。
https://nodejs.org/api/crypto.html
https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
