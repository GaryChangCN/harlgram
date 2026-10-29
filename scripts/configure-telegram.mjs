import fs from 'node:fs';
import path from 'node:path';
const root = process.env.HARLGRAM_ROOT || path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'config/telegram.local.json');
const target = path.join(root, 'entry/src/main/ets/config/TelegramBuildConfig.ets');
const mode = process.argv[2] || 'debug';
let config = { apiId: 0, apiHash: '' };
try {
  if (fs.existsSync(file)) {
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error('配置 JSON 无法解析'); }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.apiHash !== 'string') throw new Error('配置字段类型不正确');
  const empty = config.apiId === 0 && config.apiHash === '';
  if (!empty && (!Number.isSafeInteger(config.apiId) || config.apiId <= 0 || config.apiId > 2147483647 || !/^[0-9a-f]{32}$/i.test(config.apiHash))) throw new Error('格式不正确');
  if (mode === 'release' && (empty || config.apiId === 4)) throw new Error('release 构建必须配置自己的 Telegram API 身份');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const source = '// Generated locally. Never commit this file.\n' +
    `export const TELEGRAM_API_ID: number = ${config.apiId};\n` +
    `export const TELEGRAM_API_HASH: string = ${JSON.stringify(config.apiHash)};\n`;
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== source) fs.writeFileSync(target, source, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
  console.log(empty ? 'Telegram API 身份未配置；本次构建可用于界面和原生库验证。' : 'Telegram 本地构建配置已生成（不输出凭据）。');
} catch (error) {
  console.error(`Telegram 配置检查失败：${error.message}。请检查 config/telegram.local.json。`);
  process.exit(1);
}
