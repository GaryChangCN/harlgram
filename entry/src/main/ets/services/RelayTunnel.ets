import { socket, webSocket } from '@kit.NetworkKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { RelayConfiguration, RelayLocalProxy, RelaySocksHandshake, RelayTarget, relayHeaders, relayProbePacket, relayProbeResponse, socksReply } from '../model/RelayModels';

interface RelayConnection {
  local: socket.TCPSocketConnection; handshake: RelaySocksHandshake; remote?: webSocket.WebSocket;
  live: boolean; opened: boolean; sent: boolean; received: boolean; timer: number; incoming: number; outgoing: number; chain: Promise<void>; writes: Promise<void>;
}
function randomHex(): string {
  let result = ''; cryptoFramework.createRandom().generateRandomSync(16).data.forEach((n: number) => { result += n.toString(16).padStart(2, '0'); });
  return result;
}
function relayUrl(config: RelayConfiguration, target: RelayTarget): string {
  return config.endpoint.replace(/^https:/, 'wss:') + '/v1/tunnel?host=' + target.host + '&port=' + target.port;
}
function dial(ws: webSocket.WebSocket, config: RelayConfiguration, target: RelayTarget, closed: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let ended = false;
    const complete = (ok: boolean): void => {
      if (ended) return; ended = true; clearTimeout(timer);
      if (ok) resolve(); else reject(new Error('中转连接失败，请检查域名、令牌和网络'));
    };
    const timer = setTimeout(() => { complete(false); ws.close().catch(() => {}); }, 15000);
    ws.on('open', (error: BusinessError) => complete(!error || error.code === 0));
    ws.on('error', () => { complete(false); closed(); }); ws.on('close', () => { complete(false); closed(); });
    ws.connect(relayUrl(config, target), { header: relayHeaders(config),
      skipServerCertVerification: false, proxy: 'no-proxy', pingInterval: 20, pongTimeout: 10 }).then((ok: boolean) => {
        if (!ok) complete(false);
      }).catch(() => complete(false));
  });
}

/** Only encrypted MTProto bytes leave the app, through authenticated WSS. */
export class RelayTunnel {
  private server: socket.TCPSocketServer | undefined = undefined;
  private clients: Map<number, RelayConnection> = new Map();
  private stopped: boolean = false;
  private username: string = randomHex();
  private password: string = randomHex();
  private config: RelayConfiguration;
  private failed: () => void;
  constructor(config: RelayConfiguration, failed: () => void) { this.config = config; this.failed = failed; }
  async open(): Promise<RelayLocalProxy> {
    const server = socket.constructTCPSocketServerInstance(); this.server = server;
    server.on('connect', (local: socket.TCPSocketConnection) => this.accept(local));
    server.on('error', () => { if (!this.stopped) this.failed(); });
    await server.listen({ address: '127.0.0.1', port: 0, family: 1 });
    const address = await server.getLocalAddress();
    if (this.stopped) { await server.close(); throw new Error('中转已关闭'); }
    if (!address.port) { await server.close(); throw new Error('中转监听端口不可用'); }
    return { server: '127.0.0.1', port: address.port, username: this.username, password: this.password };
  }
  private accept(local: socket.TCPSocketConnection): void {
    if (this.stopped || this.clients.size >= 16) { local.close().catch(() => {}); return; }
    const item: RelayConnection = { local: local, handshake: new RelaySocksHandshake(this.username, this.password), live: true,
      opened: false, sent: false, received: false, timer: -1, incoming: 0, outgoing: 0, chain: Promise.resolve(), writes: Promise.resolve() };
    this.clients.set(local.clientId, item);
    item.timer = setTimeout(() => this.drop(item), 18000);
    local.on('close', () => this.drop(item)); local.on('error', () => this.drop(item));
    local.on('message', (message: socket.SocketMessageInfo) => {
      if (!item.live) return;
      const bytes = new Uint8Array(message.message).slice();
      item.incoming += bytes.byteLength;
      if (item.incoming > 1024 * 1024) { this.drop(item); return; }
      item.chain = item.chain.then(async (): Promise<void> => {
        if (!item.live) return;
        if (item.opened) { await this.upstream(item, bytes.buffer as ArrayBuffer); }
        else {
          const step = item.handshake.feed(bytes.buffer);
          for (const reply of step.replies) { if (item.live) await local.send({ data: reply }); }
          if (step.failed) { this.drop(item); return; }
          if (step.target) {
            await this.connect(item, step.target);
            if (item.live && step.pending.byteLength) await this.upstream(item, step.pending);
          }
        }
        item.incoming -= bytes.byteLength;
      }).catch(() => { if (item.live && !this.stopped) this.failed(); this.drop(item); });
    });
  }
  private async connect(item: RelayConnection, target: RelayTarget): Promise<void> {
    const ws = webSocket.createWebSocket(); item.remote = ws;
    ws.on('message', (error: BusinessError, data: string | ArrayBuffer) => {
      if (!item.live) return;
      if ((error && error.code !== 0) || typeof data === 'string') { this.drop(item); return; }
      if (!item.received) { item.received = true; console.info('HarlgramRelay downstream'); }
      const bytes = new Uint8Array(data).slice(); item.outgoing += bytes.byteLength;
      if (item.outgoing > 1024 * 1024) { this.drop(item); return; }
      item.writes = item.writes.then(async (): Promise<void> => {
        if (item.live) await item.local.send({ data: bytes.buffer });
        item.outgoing -= bytes.byteLength;
      }).catch(() => this.drop(item));
    });
    await dial(ws, this.config, target, () => {
      if (item.live && !item.opened && !this.stopped) this.failed();
      this.drop(item);
    });
    if (!item.live || this.stopped) { this.drop(item); return; }
    await item.local.send({ data: socksReply(0) }); item.opened = true; console.info('HarlgramRelay opened');
    clearTimeout(item.timer); item.timer = -1;
  }
  private async upstream(item: RelayConnection, bytes: ArrayBuffer): Promise<void> {
    for (let offset = 0; item.live && offset < bytes.byteLength; offset += 65536) {
      const ok = await item.remote?.send(bytes.slice(offset, Math.min(bytes.byteLength, offset + 65536)));
      if (!ok) throw new Error('中转发送失败');
      if (!item.sent) { item.sent = true; console.info('HarlgramRelay upstream'); }
    }
  }
  private drop(item: RelayConnection): void {
    if (!item.live) return; item.live = false; clearTimeout(item.timer); this.clients.delete(item.local.clientId);
    try { item.local.off('message'); item.local.off('close'); item.local.off('error'); } catch (_) {}
    item.local.close().catch(() => {});
    try { item.remote?.off('message'); } catch (_) {}
    item.remote?.close().catch(() => {});
  }
  close(): void {
    if (this.stopped) return; this.stopped = true;
    this.clients.forEach((item: RelayConnection) => this.drop(item));
    const server = this.server; this.server = undefined;
    try { server?.off('connect'); server?.off('error'); } catch (_) {}
    server?.close().catch(() => {});
  }
  static async test(config: RelayConfiguration): Promise<void> {
    const nonce = cryptoFramework.createRandom().generateRandomSync(16).data;
    const ws = webSocket.createWebSocket(); let bytes: Uint8Array = new Uint8Array(0);
    let timer: number = -1;
    let failed: () => void = () => {};
    try {
      const response = new Promise<void>((resolve, reject) => {
        failed = () => reject(new Error('中转连接失败，请检查域名、令牌和网络'));
        timer = setTimeout(() => reject(new Error('中转测试超时，请检查网络后重试')), 20000);
        ws.on('message', (error: BusinessError, chunk: string | ArrayBuffer) => {
          if ((error && error.code !== 0) || typeof chunk === 'string') { reject(new Error('中转返回无效数据')); return; }
          const data = new Uint8Array(chunk);
          if (bytes.length + data.length > 65536) { reject(new Error('中转返回无效数据')); return; }
          const next = new Uint8Array(bytes.length + data.length); next.set(bytes); next.set(data, bytes.length); bytes = next;
          const state = relayProbeResponse(bytes, nonce);
          if (state === 'valid') resolve(); else if (state === 'invalid') reject(new Error('中转协议验证失败'));
        });
      });
      // Attach immediately, so an early native error cannot become an unhandled rejection while dialing.
      response.catch(() => {});
      await dial(ws, config, { host: '149.154.167.51', port: 443 }, failed);
      if (!await ws.send(relayProbePacket(nonce, Date.now()))) throw new Error('中转测试发送失败');
      await response;
    } finally {
      clearTimeout(timer);
      try { ws.off('message'); ws.off('open'); ws.off('error'); ws.off('close'); } catch (_) {}
      ws.close().catch(() => {});
    }
  }
}
