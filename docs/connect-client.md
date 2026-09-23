# 连接已经部署的 BeeBot 服务器

服务端由管理员独立部署。普通用户不需要 SSH、Docker、服务器私钥或
本机模型配置；客户端只负责连接、登录和使用已授权的 Bot。

## 首次连接

打开 **设置 → 服务器**，填写管理员提供的 HTTPS 服务地址（不带路径、
Token 或密码），点击“添加服务器”。应用先只读检查，显示服务器名称、
地址和节点编号。请核对地址来自可信管理员：名称和节点编号不是信任证明。

点击“确认服务器并继续”后，应用会重新核对同一服务器并保存连接。检查
五分钟后过期；地址、身份或安全协议变化时需要重新检查，不忽略证书错误。

填写便于管理员识别的设备名称，点击“登录”。系统浏览器负责账号登录和
设备批准。第一次建立管理员设备时，按已有所有者恢复流程操作；已有管理员
时，请它在“安全与设备”中核对并批准本设备申请及权限。回浏览器检查批准
结果，然后返回 BeeBot。客户端不会把未知设备自动提升为管理员。

“等待登录或批准”还不是已连接。应用收到服务器的事件会话确认后才显示
已连接，并只展示权限允许的 Bot；空列表可能是没有获准访问的 Bot，并非
服务器没有数据。模型是否可执行与连接是否成功是两回事。

## 取消与安全事件

取消登录只结束本次客户端等待，服务器上的待批准申请仍可能存在，直到
管理员拒绝或申请过期。关闭设置页不会删除 Bot、撤销既有信任或取消远端任务。
要撤销会话，请明确退出；设备丢失时，请可信管理员封禁设备。怀疑有恶意任务
时，再使用“封禁并冻结关联任务”，不能把它当作普通退出。

网络断开时保留草稿并重新连接，不反复交办同一项工作。旧服务器缺少必需
安全能力时，请管理员升级；不要改用长期 Token 或关闭证书验证。

## Connect an existing server

Open **Settings → Servers**, enter the trusted administrator's HTTPS origin,
then **Add server** to inspect its public identity and security metadata. Confirm
the server explicitly; this rechecks and saves a signed-out connection. A check
expires after five minutes. Node names/IDs are labels, not proof of trust.

Choose this device's label, then **Sign in**. The system browser handles login,
first-device recovery or trusted-admin approval. New devices have no Bot access
before approval. Use the browser's approval-status check and return to BeeBot.
Only after the server confirms the authenticated event session is it connected;
model readiness is a separate concern. No server installation is done by the app.

Cancel sign-in ends the local wait only. It does not withdraw a server approval
request or revoke an earlier trusted device. Explicit sign-out, device blocking
and blocking plus task freezing are separate operations. Existing deployment
and safety documentation remains applicable; QR pairing and public short-code
lookup are not implemented by this change.
