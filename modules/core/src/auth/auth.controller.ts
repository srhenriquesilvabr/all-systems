import { Public, requestContext } from '@all/module-sdk';
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CoreConfig } from '../config';
import { AuthService } from './auth.service';
import type { ClientInfo, IssuedSession } from './session.service';

export const REFRESH_COOKIE = 'as_rt';
const COOKIE_PATH = '/api/auth';

const email = z.string().trim().email().max(254);
const password = z.string().min(10, 'A senha precisa ter ao menos 10 caracteres').max(200);

const loginBody = z.object({ email, password: z.string().min(1).max(200) });
const selectTenantBody = z.object({ selectionToken: z.string().min(1), tenantId: z.string().uuid() });
const switchTenantBody = z.object({ tenantId: z.string().uuid() });
const forgotBody = z.object({ email });
const tokenQuery = z.object({ token: z.string().min(1) });
const setPasswordBody = z.object({ token: z.string().min(1), password, name: z.string().trim().min(2).max(120).optional() });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: CoreConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodPipe(loginBody)) body: z.infer<typeof loginBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.email, body.password, clientOf(req));
    if (result.kind === 'select-tenant') {
      return { selectTenant: true, selectionToken: result.selectionToken, tenants: result.tenants };
    }
    return this.startSession(res, result);
  }

  @Public()
  @Post('select-tenant')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async selectTenant(
    @Body(new ZodPipe(selectTenantBody)) body: z.infer<typeof selectTenantBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.startSession(res, await this.auth.selectTenant(body.selectionToken, body.tenantId, clientOf(req)));
  }

  @Post('switch-tenant')
  @HttpCode(200)
  async switchTenant(
    @Body(new ZodPipe(switchTenantBody)) body: z.infer<typeof switchTenantBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId } = requestContext.require();
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) await this.auth.logout(refreshToken);
    return this.startSession(res, await this.auth.switchTenant(userId, body.tenantId, clientOf(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException();
    try {
      const session = await this.auth.refresh(token, clientOf(req));
      this.setRefreshCookie(res, session);
      return { accessToken: session.accessToken };
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) await this.auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async forgotPassword(@Body(new ZodPipe(forgotBody)) body: z.infer<typeof forgotBody>) {
    await this.auth.forgotPassword(body.email);
  }

  @Public()
  @Get('token-info')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  tokenInfo(@Query(new ZodPipe(tokenQuery)) query: z.infer<typeof tokenQuery>) {
    return this.auth.tokenInfo(query.token);
  }

  @Public()
  @Post('set-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async setPassword(@Body(new ZodPipe(setPasswordBody)) body: z.infer<typeof setPasswordBody>) {
    await this.auth.setPassword(body.token, body.password, body.name);
  }

  private startSession(res: Response, session: IssuedSession & { tenant: { id: string; name: string } }) {
    this.setRefreshCookie(res, session);
    return { accessToken: session.accessToken, tenant: session.tenant };
  }

  private setRefreshCookie(res: Response, session: IssuedSession) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: session.refreshExpiresAt,
    });
  }
}

const clientOf = (req: Request): ClientInfo => ({ userAgent: req.headers['user-agent'], ip: req.ip });
