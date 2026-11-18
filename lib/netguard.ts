// On the hosted service (SaaS) the server must not reach its own network on a user's behalf: test browsers and project
// databases have to be on the public internet. Self-hosted, anything goes (callers check isSaas()).
import dns from 'node:dns/promises';

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
export const privateIp = (ip: string) =>
  ip.includes(':')
    ? /^(::1?$|f[cd]|fe[89ab]|::ffff:)/i.test(ip) && !/^::ffff:(?!10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(ip)
    : PRIVATE_V4.some((r) => r.test(ip));

/** True when the host name is, or resolves to, a private, loopback or internal address. */
export async function isPrivateHost(hostname: string) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return true;
  const ips = /^[\d.]+$|:/.test(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  return ips.some(privateIp);
}
