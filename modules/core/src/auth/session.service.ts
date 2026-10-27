import { uuidv7 } from '@all/db';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { hashToken, newToken } from '../common/crypto';
import { refreshTokens } from '../db/schema';
import { TenantDb } from '../db/tenant-db';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 3600_000;
/** Janela em que reusar um refresh recém-rotacionado é tratado como corrida entre abas, não roubo. */
export const CONCURRENT_REFRESH_GRACE_MS = 10_000;

export interface AccessClaims {
  sub: string;
  tid: string;
  typ: 'access';
}

interface SelectionClaims {
  sub: string;
  typ: 'tenant-select';
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

/**
 * Tokens de sessão.
 * - Access: JWT curto (15 min), carrega usuário e tenant.
 * - Refresh: opaco, guardado como hash, rotacionado a cada uso. Reusar um refresh já
 *   rotacionado indica roubo: a família inteira é revogada.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    private readonly tdb: TenantDb,
  ) {}

  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(token);
      return claims.typ === 'access' ? claims : null;
    } catch {
      return null;
    }
  }

  /** Token de 5 min para escolher o tenant quando o usuário pertence a vários. */
  signSelectionToken(userId: string) {
    return this.jwt.signAsync({ sub: userId, typ: 'tenant-select' } satisfies SelectionClaims, { expiresIn: 300 });
  }

  async verifySelectionToken(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<SelectionClaims>(token);
      if (claims.typ === 'tenant-select') return claims.sub;
    } catch {
      // cai no erro abaixo
    }
    throw new UnauthorizedException({ code: 'SELECTION_EXPIRED', message: 'Faça login novamente' });
  }

  async issue(userId: string, tenantId: string, client: ClientInfo, familyId = uuidv7()): Promise<IssuedSession> {
    const refreshToken = newToken();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await this.tdb.db.insert(refreshTokens).values({
      userId,
      tenantId,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt,
      userAgent: client.userAgent?.slice(0, 300),
      ip: client.ip,
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, tid: tenantId, typ: 'access' } satisfies AccessClaims, {
      expiresIn: ACCESS_TTL_SECONDS,
    });
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  /** Troca o refresh token por um novo par. Não verifica membership: quem chama faz isso. */
  async rotate(refreshToken: string, client: ClientInfo) {
    const [current] = await this.tdb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
    if (!current) throw new UnauthorizedException();

    if (current.revokedAt) {
      // Duas abas (ou dois pedidos simultâneos) renovando com o mesmo cookie: a segunda chega logo depois
      // da rotação. Isso não é roubo; responde 401 sem derrubar a sessão (o cliente tenta de novo com o
      // cookie novo). Reuso fora dessa janela continua sendo tratado como token roubado.
      if (Date.now() - current.revokedAt.getTime() < CONCURRENT_REFRESH_GRACE_MS) {
        throw new UnauthorizedException({ code: 'REFRESH_RACE', message: 'Sessão renovada por outra aba' });
      }
      await this.revokeFamily(current.familyId);
      throw new UnauthorizedException({ code: 'REFRESH_REUSED', message: 'Sessão encerrada por segurança. Entre novamente.' });
    }
    if (current.expiresAt < new Date()) throw new UnauthorizedException();

    // Revoga com condição: duas renovações simultâneas com o mesmo token não geram duas sessões.
    const revoked = await this.tdb.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, current.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (!revoked.length) throw new UnauthorizedException();

    const session = await this.issue(current.userId, current.tenantId, client, current.familyId);
    return { ...session, userId: current.userId, tenantId: current.tenantId };
  }

  async revokeByToken(refreshToken: string) {
    const [current] = await this.tdb.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
    if (current) await this.revokeFamily(current.familyId);
  }

  async revokeAllForUser(userId: string) {
    await this.tdb.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  private async revokeFamily(familyId: string) {
    await this.tdb.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}
