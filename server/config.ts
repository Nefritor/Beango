import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const DEFAULT_PORT = 54321;

export function readConfiguration(directory: string, environment: NodeJS.ProcessEnv = process.env, overrides: NodeJS.ProcessEnv = {}) {
  const envPath = join(directory, '.env');
  const loaded = existsSync(envPath);
  let file: NodeJS.ProcessEnv = {};
  if (loaded) {
    const bytes = readFileSync(envPath);
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    let content: string;
    try { content = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { throw new Error(`Не удалось прочитать ${envPath}. Сохраните файл в UTF-8 или UTF-16 с BOM.`); }
    if (content.includes('\0')) throw new Error(`Не удалось прочитать ${envPath}. Сохраните файл в UTF-8 или UTF-16 с BOM.`);
    file = parseEnv(content);
  }
  const values = { ...environment, ...file, ...overrides };
  const rawPort = values.PORT?.trim() || String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть целым числом от 1 до 65535.');
  return {
    envPath, loaded, port, host: values.HOST || '0.0.0.0',
    dataDirectory: resolve(directory, values.DATA_DIR || 'data'),
    publicUrl: values.PUBLIC_URL || undefined,
    allowedHosts: (values.ALLOWED_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
    trustedLanCidrs: (values.TRUSTED_LAN_CIDRS || '').split(',').map((value) => value.trim()).filter(Boolean),
  };
}
