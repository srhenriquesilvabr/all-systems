import { createHash, randomBytes } from 'node:crypto';

/** Token opaco para links de e-mail e refresh tokens. */
export const newToken = () => randomBytes(32).toString('base64url');

/** O banco guarda só o hash: um vazamento da tabela não entrega tokens válidos. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
