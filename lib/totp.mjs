// Time-based one-time passwords (RFC 6238), for test accounts that use an authenticator app. The
// secret is what the app showed when MFA was set up: the base32 text under the QR code, or the
// whole otpauth:// link.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(s) {
  const clean = String(s)
    .toUpperCase()
    .replace(/[\s=-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean))
    throw new Error('That isn’t a valid authenticator secret (base32 letters A–Z and digits 2–7).');
  let bits = 0,
    value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
/** { secret, digits, period, algorithm } from a base32 secret or an otpauth:// URI. */
function parseTotp(input) {
  const s = String(input || '').trim();
  if (/^otpauth:\/\//i.test(s)) {
    const u = new URL(s);
    const algo = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    return {
      secret: u.searchParams.get('secret') || '',
      digits: Number(u.searchParams.get('digits')) || 6,
      period: Number(u.searchParams.get('period')) || 30,
      algorithm: ['SHA1', 'SHA256', 'SHA512'].includes(algo) ? algo : 'SHA1',
    };
  }
  return { secret: s, digits: 6, period: 30, algorithm: 'SHA1' };
}
/** The current code. `at` (ms) for tests. Returns { code, secondsLeft }. */
export function totp(input, at = Date.now()) {
  const { secret, digits, period, algorithm } = parseTotp(input);
  const counter = Math.floor(at / 1000 / period);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algorithm.toLowerCase(), base32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return {
    code: String(n % 10 ** digits).padStart(digits, '0'),
    secondsLeft: period - (Math.floor(at / 1000) % period),
  };
}
/** Throws a readable error when the secret can't make codes. */
export function checkTotp(input) {
  totp(input);
  return true;
}
