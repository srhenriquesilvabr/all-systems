import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hashPassword as hash, verifyPassword as verify } from '../common/password';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { AccessService } from '../access/access.service';
import { hashToken, newToken } from '../common/crypto';
import { CoreConfig } from '../config';
import { memberships, tenants, userTokens, users } from '../db/schema';
import { TenantDb } from '../db/tenant-db';
import { MailService } from '../mail/mail.service';
import { passwordChangedMail, passwordResetMail } from '../mail/templates';
import { SessionService, type ClientInfo, type IssuedSession } from './session.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;
const RESET_TTL_MS = 30 * 60_000;

const invalidCredentials = () =>
  new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos' });

export type LoginResult =
  | ({ kind: 'session'; tenant: { id: string; name: string } } & IssuedSession)
  | { kind: 'select-tenant'; selectionToken: string; tenants: { id: string; name: string }[] };

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly tdb: TenantDb,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly mail: MailService,
    private readonly config: CoreConfig,
  ) {}

  async login(emailInput: string, password: string, client: ClientInfo): Promise<LoginResult> {
    const email = emailInput.trim().toLowerCase();
    const [user] = await this.tdb.db.select().from(users).where(eq(users.email, email));

    if (!user?.passwordHash) {
      // Mesmo custo de CPU de um usuário existente: o tempo de resposta não revela quais e-mails existem.
      await verify(await (this.dummyHash ??= hash('senha-inexistente')), password);
      throw invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw invalidCredentials();

    if (!(await verify(user.passwordHash, password))) {
      const failed = user.failedLoginCount + 1;
      await this.tdb.db
        .update(users)
        .set(
          failed >= MAX_FAILED_LOGINS
            ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) }
            : { failedLoginCount: failed },
        )
        .where(eq(users.id, user.id));
      throw invalidCredentials();
    }

    await this.tdb.db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const available = await this.tenantsOf(user.id);
    if (!available.length) {
      throw new ForbiddenException({ code: 'NO_TENANT', message: 'Seu usuário não está vinculado a nenhuma empresa ativa' });
    }
    if (available.length === 1) {
      const tenant = available[0]!;
      return { kind: 'session', tenant, ...(await this.sessions.issue(user.id, tenant.id, client)) };
    }
    return { kind: 'select-tenant', selectionToken: await this.sessions.signSelectionToken(user.id), tenants: available };
  }

  async selectTenant(selectionToken: string, tenantId: string, client: ClientInfo) {
    const userId = await this.sessions.verifySelectionToken(selectionToken);
    return this.startTenantSession(userId, tenantId, client);
  }

  /** Troca de empresa com o usuário já logado: emite um novo par de tokens. */
  switchTenant(userId: string, tenantId: string, client: ClientInfo) {
    return this.startTenantSession(userId, tenantId, client);
  }

  async refresh(refreshToken: string, client: ClientInfo) {
    const session = await this.sessions.rotate(refreshToken, client);
    // A membership pode ter sido desativada depois do login.
    if (!(await this.access.resolve(session.tenantId, session.userId))) {
      await this.sessions.revokeByToken(session.refreshToken);
      throw new UnauthorizedException();
    }
    return session;
  }

  logout(refreshToken: string) {
    return this.sessions.revokeByToken(refreshToken);
  }

  /** Sempre "dá certo" para quem chama: não revela se o e-mail está cadastrado. */
  async forgotPassword(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const [user] = await this.tdb.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!user) return;

    const token = newToken();
    await this.tdb.db.insert(userTokens).values({
      userId: user.id,
      purpose: 'password_reset',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });
    this.mail.sendInBackground(passwordResetMail(email, `${this.config.adminUrl}/definir-senha?token=${token}`));
  }

  /** Para a tela de definir senha saber se é convite (pede nome) ou redefinição. */
  async tokenInfo(token: string) {
    const row = await this.findValidToken(token);
    return { purpose: row.purpose, email: row.email, name: row.name };
  }

  /** Conclui tanto a redefinição de senha quanto o aceite de convite. */
  async setPassword(token: string, password: string, name?: string): Promise<void> {
    const row = await this.findValidToken(token);
    const passwordHash = await hash(password);

    await this.tdb.db.transaction(async (tx) => {
      const used = await tx
        .update(userTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(userTokens.id, row.tokenId), isNull(userTokens.usedAt)))
        .returning({ id: userTokens.id });
      if (!used.length) throw invalidToken();

      await tx
        .update(users)
        .set({
          passwordHash,
          emailVerifiedAt: row.emailVerifiedAt ?? new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          ...(row.purpose === 'invite' && name ? { name } : {}),
        })
        .where(eq(users.id, row.userId));

      // Outros links de redefinição pendentes deixam de valer.
      await tx
        .update(userTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(userTokens.userId, row.userId), isNull(userTokens.usedAt), ne(userTokens.id, row.tokenId)));
    });

    await this.sessions.revokeAllForUser(row.userId);
    if (row.purpose === 'password_reset') this.mail.sendInBackground(passwordChangedMail(row.email));
  }

  /** Empresas em que o usuário pode entrar. */
  async tenantsOf(userId: string) {
    return this.tdb.withScope({ userId }, (tx) =>
      tx
        .select({ id: tenants.id, name: tenants.name })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active'), ne(tenants.status, 'cancelled')))
        .orderBy(tenants.name),
    );
  }

  private async startTenantSession(userId: string, tenantId: string, client: ClientInfo) {
    const tenant = (await this.tenantsOf(userId)).find((t) => t.id === tenantId);
    if (!tenant) throw new ForbiddenException({ code: 'NO_MEMBERSHIP', message: 'Você não tem acesso a esta empresa' });
    return { tenant, ...(await this.sessions.issue(userId, tenantId, client)) };
  }

  private async findValidToken(token: string) {
    const [row] = await this.tdb.db
      .select({
        tokenId: userTokens.id,
        purpose: userTokens.purpose,
        userId: users.id,
        email: users.email,
        name: users.name,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(userTokens)
      .innerJoin(users, eq(users.id, userTokens.userId))
      .where(and(eq(userTokens.tokenHash, hashToken(token)), isNull(userTokens.usedAt), gt(userTokens.expiresAt, new Date())));
    if (!row) throw invalidToken();
    return row;
  }
}

const invalidToken = () =>
  new BadRequestException({ code: 'INVALID_TOKEN', message: 'Link inválido ou expirado. Peça um novo.' });
