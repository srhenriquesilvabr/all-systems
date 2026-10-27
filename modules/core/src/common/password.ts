import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Hash de senha argon2id no formato PHC ($argon2id$v=19$m=…,t=…,p=…$salt$hash), o mesmo do
 * @node-rs/argon2 usado antes: hashes já gravados continuam válidos. Implementação em JS puro,
 * porque o runtime do Cloudflare Workers não carrega módulos nativos.
 */
const PARAMS = { m: 19456, t: 2, p: 1 };
const HASH_BYTES = 32;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const out = argon2id(password, salt, { ...PARAMS, dkLen: HASH_BYTES });
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${b64(salt)}$${b64(out)}`;
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(encoded);
  if (!match) return false;
  const [, m, t, p, salt, hash] = match;
  const expected = Buffer.from(hash!, 'base64');
  const out = argon2id(password, Buffer.from(salt!, 'base64'), { m: +m!, t: +t!, p: +p!, dkLen: expected.length });
  return timingSafeEqual(Buffer.from(out), expected);
}
