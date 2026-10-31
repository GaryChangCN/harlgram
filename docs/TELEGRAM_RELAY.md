# Telegram 网络中转试验

2026-10-31 用户最初要求配置 EdgeOne 和 Cloudflare，随后明确本轮先以 Cloudflare 完成。试验服务与其他服务隔离。

## 协议与端侧边界

候选协议 `harlgram-tunnel-v1` 使用 WSS：`/v1/tunnel?host=<Telegram IPv4>&port=443`，通过 `Authorization: Bearer <部署独立随机令牌>` 鉴权。WebSocket 只传二进制帧，按顺序拼接为透明 TCP 字节流；不传 TDLib JSON、不在服务端运行 Telegram 账号会话。TLS 必选，继续保留端侧 MTProto 加密。

目标仅允许 Telegram 官方公布的 IPv4 网段，端口限 80、443、5222；拒绝任意域名、私网、重复参数和在 URL 中携带访问令牌。网段依据 <https://core.telegram.org/resources/cidr.txt>，当前尚无自动更新、IPv6 或 UDP 通话支持。

试验限制：单帧最多 256 KiB、待写入最多 1 MiB、单连接累计最多 128 MiB。Cloudflare 连接 10 分钟关闭，EdgeOne 110 秒关闭以适应平台执行时长；后续端侧适配须交由 TDLib 恢复连接，禁止失败后静默直连。大媒体、背压、弱网和长时间连接仍需专项验收。

这两个地址不是 SOCKS5、HTTP CONNECT 或 MTProto 代理地址。当前应用尚未实现 TDLib 到 WSS 的本地适配，因此不能直接填入现有 TDLib 代理配置。服务端配置完成不代表客户端已经免 VPN 可用。

## 本轮状态

- Cloudflare 独立 Worker 已部署；自定义域名的健康检查、无鉴权 401、非 Telegram 目标 403，以及五个 Telegram DC 的 `req_pq_multi → resPQ` nonce 匹配已实测通过。
- 私人部署域名、账户标识和访问入口不随源码公开。协议示例使用 `wss://relay.example.invalid/v1/tunnel?host=149.154.167.51&port=443`；令牌仅放请求头。WebSocket 分帧拼接已有实验记录，但不是应用端验收。
- EdgeOne 独立新加坡 Cloud Functions、CNAME、域名所有权和免费证书已配置，HTTPS 健康检查通过。适配了云函数内部 HTTP URL，并增加入口 TLS 中间件。实际 WSS 升级仍返回 500，未通过 Telegram 协议握手；已按用户新指示后置，不能作为可用线路提供给客户端。
- 8 项本机目标限制、鉴权、TLS 中间件和 EdgeOne 请求守卫测试通过。测试仅使用随机 nonce 和虚构凭据，不使用用户手机号、验证码、账号会话或消息。
- 本轮未改 ArkTS/Native、未构建 HAP、未安装或操作设备。真实账号、消息和媒体经中转收发，以及国内无系统 VPN 的可达性均未验收。

部署源文件、上传包、去敏测试结果和本机操作记录保存在工程外的 Codex artifacts；访问令牌为独立生成的随机值，只保存在本机 0600 文件及服务端配置中，不写入 Git。EdgeOne 部署包只持有 Bearer 头的 SHA-256 验证值，不包含明文令牌。临时预览签名地址也不得公开。
