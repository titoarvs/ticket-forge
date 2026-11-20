import crypto from 'node:crypto';
import { promisify } from 'node:util';

export const scrypt: any = promisify(crypto.scrypt);
export const SESSION_COOKIE = 'tf_session';
export const SESSION_DAYS = 30;
export const INVITE_DAYS = 7;
// wait before the same pending invite can be sent again
export const INVITE_COOLDOWN_SECONDS = 60;
