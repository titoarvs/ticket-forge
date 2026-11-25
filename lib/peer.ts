// Who is really on the other end of a request. Route handlers see only headers, and every header is
// written by the sender: Next.js fills in X-Forwarded-For and X-Forwarded-Host only when the client
// sent none. The one thing a visitor cannot choose is the address of their TCP connection, so it is
// taken from the socket as each request arrives and kept with that request.
import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { isIP } from 'node:net';

// On globalThis: instrumentation.ts and the route handlers are bundled separately.
const S: { als: AsyncLocalStorage<string | null>; watching: boolean; warned: boolean } = ((
  globalThis as any
).__tfPeer ??= {
  als: new AsyncLocalStorage(),
  watching: false,
  warned: false,
});

/** Starts noting each request's connection address (called once, when the server starts). */
export function watchPeers() {
  if (S.watching) return;
  S.watching = true;
  channel('http.server.request.start').subscribe((m: any) => {
    S.als.enterWith(m.socket?.remoteAddress || null);
  });
}

/** The address this request's connection comes from, or null when it isn't known. */
export const peerAddress = (): string | null => S.als.getStore() ?? null;

/** An address without a port, brackets or the IPv4-mapped prefix, or '' when it isn't one. */
function address(value: string | null | undefined) {
  const v = String(value || '')
    .trim()
    .replace(/^\[(.+)\](:\d+)?$/, '$1')
    .replace(/^(\d+(?:\.\d+){3}):\d+$/, '$1')
    .replace(/^::ffff:(?=\d+\.)/i, '');
  return isIP(v) ? v : '';
}

/**
 * The visitor's address, for rate limits and records. With no trusted proxy (`hops` 0) that is the
 * connection itself. Behind `hops` trusted proxies, each adds the address it was reached from to
 * the end of X-Forwarded-For, so it is the one the outermost of them added: anything further left
 * came from the client.
 */
export function clientAddress(
  headers: { get(n: string): string | null },
  { peer, hops }: { peer: string | null; hops: number },
) {
  const own = address(peer) || 'unknown';
  const list = String(headers.get('x-forwarded-for') || '').split(',');
  if (!hops) {
    if (!S.warned && list.some((x) => address(x) && address(x) !== own)) {
      S.warned = true;
      console.warn(
        'A request had an X-Forwarded-For header, which is ignored because TRUST_PROXY is not set. If TicketForge runs behind a reverse proxy, set TRUST_PROXY=1 so rate limits see each visitor’s address.',
      );
    }
    return own;
  }
  return address(list[Math.max(0, list.length - hops)]) || own;
}
