import { type Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { hashToken, newToken } from '../common/crypto';
import { CoreConfig } from '../config';
import { memberships, membershipRoles, refreshTokens, roles, tenants, userTokens, users } from '../db/schema';
import { TenantDb } from '../db/tenant-db';
import { MailService } from '../mail/mail.service';
import { addedToTenantMail, inviteMail } from '../mail/templates';
import { OWNER_ROLE } from '../manifests';

const INVITE_TTL_MS = 7 * 24 * 3600_000;

@Injectable()
export class UsersService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: CoreConfig,
  ) {}

  list() {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      // Filtro explícito: a política de memberships também mostra as do próprio usuário em outros tenants.
      const rows = await tx
        .select({
          membershipId: memberships.id,
          status: memberships.status,
          createdAt: memberships.createdAt,
          user: { id: users.id, name: users.name, email: users.email, lastLoginAt: users.lastLoginAt },
          pendingInvite: users.passwordHash,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, tenantId))
        .orderBy(users.name);

      const assigned = await tx
        .select({ membershipId: membershipRoles.membershipId, id: roles.id, key: roles.key, label: roles.label })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId));

      return rows.map(({ pendingInvite, ...r }) => ({
        ...r,
        pendingInvite: pendingInvite === null,
        roles: assigned.filter((a) => a.membershipId === r.membershipId).map(({ membershipId, ...role }) => role),
      }));
    });
  }

  team() {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run((tx) =>
      tx
        .select({ id: users.id, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        // A política de memberships também mostra ao usuário as dele em outras empresas.
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, 'active')))
        .orderBy(asc(users.name)),
    );
  }

  async invite(input: { email: string; name: string; roleIds: string[] }) {
    const ctx = requestContext.require();
    const email = input.email.trim().toLowerCase();

    const result = await this.tdb.run(async (tx) => {
      const assignedRoles = await this.access.assertRolesExist(tx, input.roleIds);
      this.assertCanGrant(assignedRoles, ctx.isOwner);

      let [user] = await tx.select().from(users).where(eq(users.email, email));
      user ??= (await tx.insert(users).values({ email, name: input.name }).returning())[0]!;

      const [existing] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, user.id)));
      if (existing) throw new ConflictException({ code: 'ALREADY_MEMBER', message: 'Este e-mail já tem acesso à empresa' });

      const [membership] = await tx.insert(memberships).values({ tenantId: ctx.tenantId, userId: user.id }).returning();
      await this.assignRoles(tx, ctx.tenantId, membership!.id, input.roleIds);

      let token: string | undefined;
      if (!user.passwordHash) {
        token = newToken();
        await tx.insert(userTokens).values({
          userId: user.id,
          purpose: 'invite',
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        });
      }

      const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      await this.audit.log(tx, {
        action: 'user.invited',
        entity: 'membership',
        entityId: membership!.id,
        data: { email, roleIds: input.roleIds },
      });
      return { membershipId: membership!.id, tenantName: tenant!.name, token };
    });

    this.mail.sendInBackground(
      result.token
        ? inviteMail(email, result.tenantName, this.inviteUrl(result.token))
        : addedToTenantMail(email, result.tenantName, `${this.config.adminUrl}/entrar`),
    );
    return { membershipId: result.membershipId, pendingInvite: !!result.token, emailEnabled: this.config.emailEnabled };
  }

  emailStatus() {
    return { emailEnabled: this.config.emailEnabled };
  }

  /** Novo convite por e-mail. Os anteriores continuam valendo até o prazo: foram para a mesma caixa de entrada. */
  async resendInvite(membershipId: string) {
    const ctx = requestContext.require();
    const result = await this.tdb.run(async (tx) => {
      const target = await this.pendingInvitee(tx, membershipId);
      const token = await this.issueInviteToken(tx, target.userId);
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      await this.audit.log(tx, { action: 'user.invite_resent', entity: 'membership', entityId: membershipId, data: { email: target.email, emailEnabled: this.config.emailEnabled } });
      return { token, email: target.email, tenantName: tenant!.name };
    });
    this.mail.sendInBackground(inviteMail(result.email, result.tenantName, this.inviteUrl(result.token)));
    return { emailEnabled: this.config.emailEnabled };
  }

  /**
   * Link de convite para o dono dar acesso mesmo sem e-mail. Quem tem o link define a senha da conta,
   * que vale para todas as empresas daquele e-mail. Por isso: só de quem ainda não tem senha, só o
   * dono gera para outro dono, e nunca de quem também foi convidado por outra empresa (lá a pessoa
   * passaria a entrar pelas mãos de quem gerou o link). Gerar outro invalida os anteriores. A auditoria
   * registra quem gerou, sem guardar o token.
   */
  async inviteLink(membershipId: string) {
    const ctx = requestContext.require();
    const { userId } = await this.tdb.run((tx) => this.pendingInvitee(tx, membershipId));
    // Com o usuário-alvo no escopo, o RLS mostra os vínculos dele nas outras empresas.
    const token = await this.tdb.withScope({ tenantId: ctx.tenantId, userId }, async (tx) => {
      const target = await this.pendingInvitee(tx, membershipId);
      const other = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), ne(memberships.tenantId, ctx.tenantId)))
        .limit(1);
      if (other.length) throw new ConflictException({ code: 'INVITED_ELSEWHERE', message: 'Esta pessoa também foi convidada por outra empresa. Por segurança, o convite só pode ir para o e-mail dela.' });
      if (!ctx.isOwner) {
        const isOwnerTarget = await tx
          .select({ id: roles.id })
          .from(membershipRoles)
          .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
          .where(and(eq(membershipRoles.membershipId, membershipId), eq(roles.key, OWNER_ROLE)))
          .limit(1);
        if (isOwnerTarget.length) throw new ForbiddenException({ code: 'OWNER_ONLY', message: 'Só um dono pode gerar o link de convite de outro dono' });
      }
      await tx.update(userTokens).set({ usedAt: new Date() }).where(and(eq(userTokens.userId, userId), eq(userTokens.purpose, 'invite'), isNull(userTokens.usedAt)));
      const issued = await this.issueInviteToken(tx, userId);
      await this.audit.log(tx, { action: 'user.invite_link_created', entity: 'membership', entityId: membershipId, data: { email: target.email } });
      return issued;
    });
    return { url: this.inviteUrl(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(), emailEnabled: this.config.emailEnabled };
  }

  private inviteUrl(token: string) {
    return `${this.config.adminUrl}/definir-senha?token=${token}`;
  }

  private async issueInviteToken(tx: Tx, userId: string) {
    const token = newToken();
    await tx.insert(userTokens).values({ userId, purpose: 'invite', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
    return token;
  }

  /** Vínculo ativo desta empresa de quem ainda não criou a senha. */
  private async pendingInvitee(tx: Tx, membershipId: string) {
    const { tenantId } = requestContext.require();
    const [row] = await tx
      .select({ status: memberships.status, userId: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId)));
    if (!row) throw new NotFoundException({ code: 'MEMBERSHIP_NOT_FOUND', message: 'Usuário não encontrado' });
    if (row.status !== 'active') throw new BadRequestException({ code: 'MEMBERSHIP_DISABLED', message: 'O acesso desta pessoa está desativado. Reative antes de convidar de novo.' });
    if (row.passwordHash) throw new BadRequestException({ code: 'NOT_PENDING', message: 'Esta pessoa já criou a senha. Se esqueceu, ela pode usar Esqueci minha senha na tela de entrada.' });
    return row;
  }

  async update(membershipId: string, input: { status?: 'active' | 'disabled'; roleIds?: string[] }) {
    const ctx = requestContext.require();

    await this.tdb.run(async (tx) => {
      const [membership] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, ctx.tenantId)));
      if (!membership) throw new NotFoundException({ code: 'MEMBERSHIP_NOT_FOUND', message: 'Usuário não encontrado' });
      if (membership.userId === ctx.userId && input.status === 'disabled') {
        throw new BadRequestException({ code: 'CANNOT_DISABLE_SELF', message: 'Você não pode desativar o próprio acesso' });
      }

      const current = await tx
        .select({ id: roles.id, key: roles.key })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(eq(membershipRoles.membershipId, membershipId));
      const next = input.roleIds ? await this.access.assertRolesExist(tx, input.roleIds) : current;

      const wasOwner = current.some((r) => r.key === OWNER_ROLE);
      const willBeOwner = next.some((r) => r.key === OWNER_ROLE);
      if (wasOwner !== willBeOwner && !ctx.isOwner) {
        throw new ForbiddenException({ code: 'OWNER_ONLY', message: 'Só um dono pode conceder ou remover o papel de dono' });
      }
      const losesOwnership = wasOwner && (!willBeOwner || input.status === 'disabled');
      if (losesOwnership && !(await this.hasAnotherActiveOwner(tx, ctx.tenantId, membershipId))) {
        throw new BadRequestException({ code: 'LAST_OWNER', message: 'A empresa precisa de ao menos um dono ativo' });
      }

      if (input.status) await tx.update(memberships).set({ status: input.status }).where(eq(memberships.id, membershipId));
      if (input.roleIds) {
        await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membershipId));
        await this.assignRoles(tx, ctx.tenantId, membershipId, input.roleIds);
      }
      if (input.status === 'disabled') {
        await tx
          .delete(refreshTokens)
          .where(and(eq(refreshTokens.userId, membership.userId), eq(refreshTokens.tenantId, ctx.tenantId)));
      }
      await this.audit.log(tx, { action: 'user.updated', entity: 'membership', entityId: membershipId, data: input });
    });
  }

  private assertCanGrant(assigned: { key: string }[], isOwner: boolean | undefined) {
    if (!isOwner && assigned.some((r) => r.key === OWNER_ROLE)) {
      throw new ForbiddenException({ code: 'OWNER_ONLY', message: 'Só um dono pode conceder o papel de dono' });
    }
  }

  private async assignRoles(tx: Tx, tenantId: string, membershipId: string, roleIds: string[]) {
    if (!roleIds.length) return;
    await tx.insert(membershipRoles).values([...new Set(roleIds)].map((roleId) => ({ tenantId, membershipId, roleId })));
  }

  private async hasAnotherActiveOwner(tx: Tx, tenantId: string, exceptMembershipId: string) {
    const owners = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.status, 'active'),
          eq(roles.key, OWNER_ROLE),
          ne(memberships.id, exceptMembershipId),
        ),
      );
    return owners.length > 0;
  }
}
