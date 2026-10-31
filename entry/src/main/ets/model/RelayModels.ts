export interface RelayConfiguration { enabled: boolean; endpoint: string; token: string; headerName?: string; }
export interface RelayTarget { host: string; port: number; }
export interface RelayLocalProxy { server: string; port: number; username: string; password: string; }
export interface RelayProfile { id: string; name: string; endpoint: string; token: string; headerName?: string; }
export interface RelayRegistry { version: number; activeId: string; profiles: RelayProfile[]; }
export function relayHeaderName(value: string = 'Authorization'): string {
  const name = value.trim() || 'Authorization';
  if (name.length > 64 || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ||
    /^(host|connection|upgrade|origin|cookie|set-cookie|content-.*|sec-.*|proxy-.*|transfer-encoding|te|trailer|keep-alive|accept-encoding)$/i.test(name)) {
    throw new Error('请输入有效的令牌请求头名称，不能使用连接或系统保留字段');
  }
  return name.toLowerCase() === 'authorization' ? 'Authorization' : name;
}
export function relayHeaders(value: RelayConfiguration): Record<string, string> {
  const name = relayHeaderName(value.headerName);
  const result: Record<string, string> = {};
  result[name] = name === 'Authorization' ? 'Bearer ' + value.token : value.token;
  return result;
}
export function relayRegistry(value: RelayRegistry): RelayRegistry {
  if (!value || value.version !== 2 || typeof value.activeId !== 'string' || !Array.isArray(value.profiles) || value.profiles.length > 32) {
    throw new Error('网络配置不可读，请检查后重试');
  }
  const seen: string[] = [];
  const profiles = value.profiles.map((profile: RelayProfile): RelayProfile => {
    if (!profile || typeof profile.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(profile.id) || seen.includes(profile.id) ||
      typeof profile.name !== 'string' || !profile.name.trim() || profile.name.trim().length > 40 || /[\x00-\x1f\x7f]/.test(profile.name) ||
      typeof profile.endpoint !== 'string' || typeof profile.token !== 'string' || (profile.headerName !== undefined && typeof profile.headerName !== 'string')) {
      throw new Error('配置名称或标识无效，名称最多 40 个字符');
    }
    seen.push(profile.id);
    const config = relayConfiguration({ enabled: true, endpoint: profile.endpoint, token: profile.token, headerName: profile.headerName });
    return { id: profile.id, name: profile.name.trim(), endpoint: config.endpoint, token: config.token, headerName: config.headerName };
  });
  if (value.activeId && !seen.includes(value.activeId)) throw new Error('当前选择的代理配置不存在');
  return { version: 2, activeId: value.activeId, profiles: profiles };
}
export function relaySelected(value: RelayRegistry): RelayConfiguration {
  const registry = relayRegistry(value);
  const profile = registry.profiles.find((item: RelayProfile) => item.id === registry.activeId);
  return profile ? relayConfiguration({ enabled: true, endpoint: profile.endpoint, token: profile.token, headerName: profile.headerName }) :
    { enabled: false, endpoint: '', token: '' };
}
export function relayMigrate(value: RelayConfiguration): RelayRegistry {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.endpoint !== 'string' || typeof value.token !== 'string' ||
    (value.headerName !== undefined && typeof value.headerName !== 'string')) throw new Error('网络配置不可读');
  const config = relayConfiguration(value);
  if (!config.endpoint) return { version: 2, activeId: '', profiles: [] };
  return relayRegistry({ version: 2, activeId: config.enabled ? 'legacy' : '', profiles: [
    { id: 'legacy', name: '自建中转', endpoint: config.endpoint, token: config.token, headerName: config.headerName }
  ] });
}
export function relayUpsert(value: RelayRegistry, profile: RelayProfile): RelayRegistry {
  const profiles = value.profiles.some((item: RelayProfile) => item.id === profile.id) ?
    value.profiles.map((item: RelayProfile): RelayProfile => item.id === profile.id ? profile : item) : value.profiles.concat([profile]);
  return relayRegistry({ version: 2, activeId: value.activeId, profiles: profiles });
}
export function relayRemove(value: RelayRegistry, id: string): RelayRegistry {
  if (id === value.activeId) throw new Error('请先选择其他连接方式，再删除当前配置');
  return relayRegistry({ version: 2, activeId: value.activeId, profiles: value.profiles.filter((item: RelayProfile) => item.id !== id) });
}
export function relayConfiguration(value: RelayConfiguration): RelayConfiguration {
  const input = value.endpoint.trim().replace(/^(https|wss):\/\//i, '').replace(/\/$/, '').replace(/:443$/, '');
  if (!input && !value.enabled) return { enabled: false, endpoint: '', token: '' };
  const labels = input.split('.');
  if (input.length > 253 || labels.length < 2 || !/[a-zA-Z]/.test(input) || labels.some((label: string) =>
    label.length < 1 || label.length > 63 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label))) {
    throw new Error('请输入有效的中转域名，不包含路径或参数');
  }
  const token = value.token.trim();
  if (value.enabled && (!/^[\x21-\x7e]{32,256}$/.test(token))) throw new Error('请输入有效的访问令牌（32 至 256 个字符）');
  return { enabled: value.enabled, endpoint: 'https://' + input.toLowerCase(), token: token, headerName: relayHeaderName(value.headerName) };
}
export function relayTargetAllowed(host: string, port: number): boolean {
  if (![80, 443, 5222].includes(port) || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(host)) return false;
  const parts = host.split('.').map((part: string) => Number(part));
  if (parts.some((part: number) => part > 255)) return false;
  const number = parts.reduce((sum: number, part: number) => ((sum << 8) | part) >>> 0, 0);
  return ['91.108.56.0/22', '91.108.4.0/22', '91.108.8.0/22', '91.108.16.0/22', '91.108.12.0/22',
    '149.154.160.0/20', '91.105.192.0/23', '91.108.20.0/22', '185.76.151.0/24'].some((cidr: string) => {
      const pieces = cidr.split('/'), mask = (0xffffffff << (32 - Number(pieces[1]))) >>> 0;
      const base = pieces[0].split('.').reduce((sum: number, part: string) => ((sum << 8) | Number(part)) >>> 0, 0);
      return ((number & mask) >>> 0) === ((base & mask) >>> 0);
    });
}
export interface SocksResult { replies: ArrayBuffer[]; target?: RelayTarget; pending: ArrayBuffer; failed: boolean; }
/** Incremental SOCKS5 with mandatory per-listener RFC 1929 credentials. */
export class RelaySocksHandshake {
  private buffer: Uint8Array = new Uint8Array(0);
  private phase: number = 0;
  constructor(private username: string, private password: string) {}
  feed(chunk: ArrayBuffer): SocksResult {
    const result: SocksResult = { replies: [], pending: new ArrayBuffer(0), failed: false };
    if (this.phase >= 3 || this.buffer.length + chunk.byteLength > 8192) { result.failed = true; return result; }
    const next = new Uint8Array(this.buffer.length + chunk.byteLength); next.set(this.buffer); next.set(new Uint8Array(chunk), this.buffer.length); this.buffer = next;
    while (this.phase < 3) {
      const b = this.buffer;
      if (this.phase === 0) {
        if (b.length < 2 || b.length < 2 + b[1]) return result;
        const ok = b[0] === 5 && b.slice(2, 2 + b[1]).includes(2);
        result.replies.push(new Uint8Array([5, ok ? 2 : 255]).buffer);
        if (!ok) { result.failed = true; this.phase = 4; return result; }
        this.buffer = b.slice(2 + b[1]); this.phase = 1;
      } else if (this.phase === 1) {
        if (b.length < 2 || b.length < 3 + b[1]) return result;
        const length = 3 + b[1] + b[2 + b[1]];
        if (b.length < length) return result;
        const ok = b[0] === 1 && this.matches(b.slice(2, 2 + b[1]), this.username) && this.matches(b.slice(3 + b[1], length), this.password);
        result.replies.push(new Uint8Array([1, ok ? 0 : 1]).buffer);
        if (!ok) { result.failed = true; this.phase = 4; return result; }
        this.buffer = b.slice(length); this.phase = 2;
      } else {
        if (b.length < 4) return result;
        if (b[0] !== 5 || b[1] !== 1 || b[2] !== 0 || b[3] !== 1) {
          result.replies.push(socksReply(8)); result.failed = true; this.phase = 4; return result;
        }
        if (b.length < 10) return result;
        const host = Array.from(b.slice(4, 8)).join('.'), port = b[8] * 256 + b[9];
        if (!relayTargetAllowed(host, port)) { result.replies.push(socksReply(2)); result.failed = true; this.phase = 4; return result; }
        result.target = { host: host, port: port }; result.pending = b.slice(10).buffer;
        this.buffer = new Uint8Array(0); this.phase = 3; return result;
      }
    }
    return result;
  }
  private matches(bytes: Uint8Array, text: string): boolean {
    if (bytes.length !== text.length) return false;
    let difference = 0; bytes.forEach((value: number, index: number) => { difference |= value ^ text.charCodeAt(index); });
    return difference === 0;
  }
}
export function socksReply(code: number): ArrayBuffer { return new Uint8Array([5, code, 0, 1, 127, 0, 0, 1, 0, 0]).buffer; }
export function relayProbePacket(nonce: Uint8Array, now: number): ArrayBuffer {
  if (nonce.length !== 16) throw new Error('无效的连接测试');
  const bytes = new Uint8Array(42), view = new DataView(bytes.buffer);
  bytes[0] = 239; bytes[1] = 10;
  view.setUint32(10, Math.floor(now % 1000 / 1000 * 4294967296) & 0xfffffffc, true);
  view.setUint32(14, Math.floor(now / 1000), true); view.setUint32(18, 20, true);
  view.setUint32(22, 0xbe7e8ef1, true); bytes.set(nonce, 26); return bytes.buffer;
}
export function relayProbeResponse(bytes: Uint8Array, nonce: Uint8Array): string {
  if (bytes.length > 65536) return 'invalid';
  if (!bytes.length) return 'pending';
  const prefix = bytes[0] === 127 ? 4 : 1;
  if (bytes.length < prefix) return 'pending';
  const size = (prefix === 4 ? bytes[1] + bytes[2] * 256 + bytes[3] * 65536 : bytes[0]) * 4;
  if (size < 40 || size > 65532) return 'invalid';
  if (bytes.length < prefix + size) return 'pending';
  const message = bytes.slice(prefix, prefix + size), view = new DataView(message.buffer);
  if (view.getUint32(20, true) !== 0x05162463 || message.slice(0, 8).some((n: number) => n !== 0)) return 'invalid';
  return nonce.every((n: number, index: number) => message[index + 24] === n) ? 'valid' : 'invalid';
}
