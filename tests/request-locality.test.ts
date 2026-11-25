// Who counts as "on this computer" and which address rate limits use. Run with `npm test`.
// Every header is written by whoever sends the request, so neither may depend on headers alone.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { requestIsLocal, trustedProxyHops } from '../lib/platform';
import { isLocalHost } from '../lib/claude';
import { peerAddress, clientAddress } from '../lib/peer';
import { register } from '../instrumentation';

const LAN = '192.168.1.50';
const VARS = ['TICKETFORGE_MODE', 'TICKETFORGE_ALLOW_LOCAL', 'TRUST_PROXY'];
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
const setEnv = (vars: Record<string, string>) => {
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, vars);
};
const local = (peer: string | null, headers: Record<string, string>, env = {}) => {
  setEnv(env);
  return requestIsLocal(isLocalHost, new Headers(headers), peer);
};
const HERE = { host: 'localhost:5173' };
const SAAS_HERE = { TICKETFORGE_MODE: 'saas', TICKETFORGE_ALLOW_LOCAL: '1' };
afterEach(() => {
  setEnv({});
  for (const k of VARS) if (saved[k] !== undefined) process.env[k] = saved[k];
});

// ---------------------------------------------------------------- on this computer
test('normal localhost use is local', () => {
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
    for (const host of ['localhost:5173', '127.0.0.1:5173', '[::1]:5173', 'app.localhost'])
      assert.equal(local(peer, { host }), true, `${peer} ${host}`);
  // What Next adds when the browser sent none of these.
  assert.equal(
    local('::1', { ...HERE, 'x-forwarded-host': 'localhost:5173', 'x-forwarded-for': '::1' }),
    true,
  );
});
test('a visitor from another address is never local, whatever headers it sends', () => {
  const forged = [
    HERE,
    { host: 'forge.example.com', 'x-forwarded-host': 'localhost' },
    { ...HERE, 'x-forwarded-for': '127.0.0.1' },
    { ...HERE, 'x-forwarded-for': '::1', 'x-forwarded-host': 'localhost', 'x-real-ip': '::1' },
  ];
  for (const env of [{}, SAAS_HERE, { TRUST_PROXY: '1', TICKETFORGE_ALLOW_LOCAL: '1' }])
    for (const h of forged)
      for (const peer of [LAN, `::ffff:${LAN}`, '2001:db8::7'])
        assert.equal(local(peer, h, env), false, `${peer} ${JSON.stringify([env, h])}`);
});
test('an unknown connection address is not local', () => {
  assert.equal(local(null, HERE), false);
});
test('opened at another name, it is not local (DNS rebinding)', () => {
  assert.equal(local('127.0.0.1', { host: 'evil.example.com' }), false);
  assert.equal(
    local('127.0.0.1', { host: 'evil.example.com', 'x-forwarded-host': 'localhost' }),
    false,
  );
});
test('a visitor that comes through a proxy or tunnel on this computer is not local', () => {
  const via = [
    { 'x-forwarded-for': '203.0.113.9' },
    { 'x-forwarded-for': '127.0.0.1, 203.0.113.9' },
    { 'x-forwarded-for': '203.0.113.9, 127.0.0.1' },
    { 'x-real-ip': '203.0.113.9' },
    { 'x-forwarded-host': 'forge.example.com' },
    { 'x-forwarded-host': 'localhost, forge.example.com' },
    { forwarded: 'for=203.0.113.9' },
  ];
  for (const h of via)
    assert.equal(local('127.0.0.1', { ...HERE, ...h } as any), false, JSON.stringify(h));
});
test('a local development proxy (everything loopback) stays local', () => {
  const h = {
    host: 'app.localhost:1355',
    'x-forwarded-host': 'app.localhost:1355',
    'x-forwarded-for': '127.0.0.1',
  };
  assert.equal(local('127.0.0.1', h), true);
});
test('behind a declared reverse proxy nothing is local unless TICKETFORGE_ALLOW_LOCAL says so', () => {
  assert.equal(local('127.0.0.1', HERE, { TRUST_PROXY: '1' }), false);
  assert.equal(local('127.0.0.1', HERE, { TRUST_PROXY: '1', TICKETFORGE_ALLOW_LOCAL: '1' }), true);
});
test('hosted mode is local only with TICKETFORGE_ALLOW_LOCAL', () => {
  assert.equal(local('127.0.0.1', HERE, { TICKETFORGE_MODE: 'saas' }), false);
  assert.equal(local('127.0.0.1', HERE, SAAS_HERE), true);
});

// ---------------------------------------------------------------- the address for rate limits
const client = (peer: string | null, xff: string | null, hops: number, more = {}) =>
  clientAddress(new Headers({ ...(xff === null ? {} : { 'x-forwarded-for': xff }), ...more }), {
    peer,
    hops,
  });
test('without TRUST_PROXY the connection address is used and headers are ignored', () => {
  assert.equal(client(LAN, null, 0), LAN);
  assert.equal(client(LAN, '10.0.0.1', 0), LAN);
  assert.equal(client(LAN, null, 0, { 'x-real-ip': '10.0.0.1' }), LAN);
  assert.equal(client(`::ffff:${LAN}`, null, 0), LAN);
  assert.equal(client(null, '10.0.0.1', 0), 'unknown');
});
test('behind one proxy, the address that proxy added is used, not what the client put first', () => {
  assert.equal(client('127.0.0.1', '203.0.113.9', 1), '203.0.113.9');
  assert.equal(client('127.0.0.1', '10.0.0.1, 203.0.113.9', 1), '203.0.113.9');
  assert.equal(client('127.0.0.1', '1.1.1.1, 2.2.2.2, 203.0.113.9', 1), '203.0.113.9');
});
test('behind several proxies, the address the outermost trusted one added is used', () => {
  assert.equal(client('127.0.0.1', '6.6.6.6, 203.0.113.9, 10.0.0.2', 2), '203.0.113.9');
  assert.equal(client('127.0.0.1', '203.0.113.9', 2), '203.0.113.9'); // came in past the first proxy
});
test('ports and IPv4-mapped forms do not make new addresses', () => {
  assert.equal(client('127.0.0.1', '203.0.113.9:51234', 1), '203.0.113.9');
  assert.equal(client('127.0.0.1', '::ffff:203.0.113.9', 1), '203.0.113.9');
  assert.equal(client('127.0.0.1', '[2001:db8::7]:443', 1), '2001:db8::7');
});
test('a forwarded value that is not an address falls back to the connection', () => {
  assert.equal(client('127.0.0.1', 'unknown', 1), '127.0.0.1');
  assert.equal(client('127.0.0.1', '', 1), '127.0.0.1');
});
test('TRUST_PROXY is off, on (one proxy) or a number of proxies', () => {
  const hops = (v: string) => {
    setEnv({ TRUST_PROXY: v });
    return trustedProxyHops();
  };
  for (const v of ['', ' ', '0', 'false', 'no', 'off']) assert.equal(hops(v), 0, v);
  for (const v of ['1', 'true', 'yes', 'loopback']) assert.equal(hops(v), 1, v);
  assert.equal(hops('2'), 2);
});

// ---------------------------------------------------------------- the connection address itself
// The real hook, the way the server starts it (instrumentation.ts), on a real HTTP server.
let server: http.Server;
let port = 0;
const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const get = (host: string, headers = {}) =>
  new Promise<string>((resolve, reject) => {
    http
      .get({ host, port, headers, agent }, (res) => {
        let t = '';
        res.on('data', (d) => (t += d));
        res.on('end', () => resolve(t));
      })
      .on('error', reject);
  });
before(async () => {
  const runtime = process.env.NEXT_RUNTIME;
  const urls = [process.env.DATABASE_URL, process.env.SUPABASE_DB_URL];
  process.env.DATABASE_URL = process.env.SUPABASE_DB_URL = ''; // never a real database
  process.env.NEXT_RUNTIME = 'nodejs';
  await register();
  await register(); // Next may load it again (development)
  if (runtime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = runtime;
  for (const [i, k] of ['DATABASE_URL', 'SUPABASE_DB_URL'].entries())
    if (urls[i] === undefined) delete process.env[k];
    else process.env[k] = urls[i];
  server = http.createServer(async (_req, res) => {
    await new Promise((r) => setTimeout(r, 1));
    res.end(String(peerAddress()));
  });
  await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
  port = (server.address() as any).port;
});
after(() => {
  agent.destroy();
  server.close();
});
test('the connection address is the socket’s and headers cannot change it', async () => {
  const forged = {
    'x-forwarded-for': '10.0.0.1',
    'x-real-ip': '10.0.0.1',
    'x-tf-peer': '10.0.0.1',
  };
  for (const h of [{}, forged, {}]) assert.equal(await get('127.0.0.1', h), '127.0.0.1');
});
test(
  'a connection to the network address is seen as that address',
  { skip: lan ? false : 'no network address on this machine' },
  async () => {
    const forged = { host: 'localhost', 'x-forwarded-for': '127.0.0.1' };
    const [a, b] = await Promise.all([get(lan!, forged), get('127.0.0.1')]);
    assert.deepEqual([a, b], [lan, '127.0.0.1']);
  },
);
test('outside a request there is no connection address', () => {
  assert.equal(peerAddress(), null);
});
