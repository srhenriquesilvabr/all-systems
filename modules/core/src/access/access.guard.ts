import { MODULE_KEY, PERMISSIONS_KEY, PUBLIC_KEY, requestContext } from '@all/module-sdk';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { AccessService } from './access.service';

/**
 * Guard global. Ordem das verificações:
 * token válido → membro ativo do tenant → tenant ativo → módulo da rota ativo → permissões.
 * Ao final, preenche o contexto da requisição (tenant, usuário, módulos, permissões).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();
    const claims = await this.sessions.verifyAccessToken(token);
    if (!claims) throw new UnauthorizedException();

    const access = await this.access.resolve(claims.tid, claims.sub);
    if (!access) throw new ForbiddenException({ code: 'NO_MEMBERSHIP', message: 'Você não tem acesso a esta empresa' });

    const readOnly = req.method === 'GET' || req.method === 'HEAD';
    if (access.tenantStatus === 'cancelled') {
      throw new ForbiddenException({ code: 'TENANT_CANCELLED', message: 'A assinatura desta empresa foi cancelada' });
    }
    if (access.tenantStatus === 'suspended' && !readOnly) {
      throw new ForbiddenException({ code: 'TENANT_SUSPENDED', message: 'Empresa suspensa: acesso somente leitura' });
    }

    const moduleKey = this.reflector.getAllAndOverride<string | undefined>(MODULE_KEY, targets);
    if (moduleKey) {
      const status = access.modules.get(moduleKey);
      if (!status) throw new ForbiddenException({ code: 'MODULE_NOT_ENABLED', message: 'Módulo não contratado' });
      if (status === 'suspended' && !readOnly) {
        throw new ForbiddenException({ code: 'MODULE_SUSPENDED', message: 'Módulo suspenso: acesso somente leitura' });
      }
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets) ?? [];
    const missing = required.filter((p) => !access.permissions.has(p));
    if (missing.length) {
      throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Você não tem permissão para esta ação', missing });
    }

    Object.assign(requestContext.get(), {
      userId: claims.sub,
      tenantId: claims.tid,
      membershipId: access.membershipId,
      isOwner: access.isOwner,
      modules: new Set(access.modules.keys()),
      permissions: access.permissions,
    });
    return true;
  }
}
