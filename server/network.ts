import { BlockList, isIP } from 'node:net';
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { IncomingMessage } from 'node:http';

export function normalizeAddress(address: string | undefined): string {
  return (address ?? '').replace(/^::ffff:/i, '').split('%')[0];
}

function privateAddress(address: string) {
  if (isIP(address) === 4) return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(address);
  return /^(fc|fd|fe80:)/i.test(address);
}

export function localPeerChecker(
  cidrs: string[] = [],
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): (address: string | undefined) => boolean {
  const trusted = new BlockList();
  trusted.addSubnet('127.0.0.0', 8, 'ipv4');
  trusted.addAddress('::1', 'ipv6');
  const detected = Object.values(interfaces).flatMap((items) => items ?? [])
    .filter((item) => !item.internal && item.cidr && privateAddress(item.address)).map((item) => item.cidr!);
  for (const cidr of cidrs.length ? cidrs : detected) {
    const [address, rawPrefix] = cidr.trim().split('/');
    const family = isIP(address);
    const prefix = Number(rawPrefix);
    if (!family || !rawPrefix || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) {
      throw new Error(`Неверная локальная подсеть: ${cidr}`);
    }
    trusted.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return (raw) => {
    const address = normalizeAddress(raw);
    const family = isIP(address);
    return family !== 0 && trusted.check(address, family === 4 ? 'ipv4' : 'ipv6');
  };
}

export function validRequestHost(request: IncomingMessage, allowedHosts: string[]): boolean {
  try {
    const host = new URL(`http://${request.headers.host ?? ''}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return Boolean(isIP(host)) || ['localhost', hostname().toLowerCase(), ...allowedHosts].includes(host);
  } catch { return false; }
}

export function validOrigin(request: IncomingMessage): boolean {
  if (!request.headers.origin) return true;
  try {
    const origin = new URL(request.headers.origin);
    return ['http:', 'https:'].includes(origin.protocol) && origin.host.toLowerCase() === request.headers.host?.toLowerCase();
  } catch { return false; }
}

export function localUrls(port: number) {
  return Object.entries(networkInterfaces())
    .filter(([name]) => !/vethernet|wsl|docker|hyper-v|virtualbox|vmware/i.test(name))
    .flatMap(([, items]) => items ?? [])
    .filter((item) => item.family === 'IPv4' && !item.internal && privateAddress(item.address))
    .map((item) => `http://${item.address}:${port}`)
    .sort((a, b) => Number(b.includes('192.168.')) - Number(a.includes('192.168.')));
}
