import { ModuleRegistry, Public, requestContext } from '@all/module-sdk';
import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { and, count, eq, gt } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CoreConfig } from '../config';
import { isValidCnpj, isValidCpf, normalizeCnpj, onlyDigits } from '../customers/br';
import { tenantSignups } from '../db/schema';
import { TenantDb } from '../db/tenant-db';
import { TenancyService } from './tenancy.service';

/** Versão do texto de consentimento mostrado em /contratar. Mudou o texto, muda a versão. */
export const SIGNUP_CONSENT_VERSION = '2026-10-30';
const HOURLY_LIMIT_PER_IP = 5;
/** Robôs preenchem na hora; uma pessoa leva mais que isso. */
const MIN_FILL_MS = 3000;
const HOUR = 3600_000;

const signupBody = z.object({
  branch: z.string().min(1).max(60),
  companyName: z.string().trim().min(2, 'Informe o nome da empresa').max(120),
  document: z.string().trim().max(20).optional(),
  ownerName: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: z.string().trim().email('E-mail inválido').max(254),
  password: z.string().min(10, 'A senha precisa ter ao menos 10 caracteres').max(200),
  consent: z.literal(true, { errorMap: () => ({ message: 'É preciso autorizar o uso dos dados para criar a conta' }) }),
  /** Campo escondido: só robô preenche. */
  website: z.string().max(200).optional(),
  /** Quando o formulário abriu (ms desde 1970, relógio do navegador). */
  openedAt: z.number().int(),
});

/**
 * Contratação pelo site: a empresa escolhe UM ramo e já entra em teste, só com esse ramo e os
 * recursos de que ele depende. Ramos e módulos adicionais vêm depois, pelo dono, em /modules.
 */
@Public()
@Controller('public/signup')
export class SignupController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly registry: ModuleRegistry,
    private readonly tdb: TenantDb,
    private readonly config: CoreConfig,
  ) {}

  @Get('branches')
  branches() {
    return this.registry
      .all()
      .filter((m) => m.layer === 'vertical')
      .map((m) => ({ key: m.key, name: m.name, description: m.description, icon: m.icon }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 10 * 60_000 } })
  async signup(@Body(new ZodPipe(signupBody)) body: z.infer<typeof signupBody>) {
    if (body.website || Date.now() - body.openedAt < MIN_FILL_MS) {
      throw new BadRequestException({ code: 'SIGNUP_REJECTED', message: 'Não foi possível concluir o cadastro. Atualize a página e tente de novo.' });
    }
    if (this.registry.get(body.branch)?.layer !== 'vertical') {
      throw new BadRequestException({ code: 'INVALID_BRANCH', message: 'Escolha o ramo da empresa' });
    }
    const document = normalizeDocument(body.document);
    const ipHash = this.hashIp(requestContext.get().ip);
    await this.checkLimits(ipHash);

    const { tenantId } = await this.tenancy.createTenant({
      name: body.companyName,
      document,
      status: 'trial',
      selfService: true,
      modules: [body.branch],
      owner: { email: body.email, name: body.ownerName, password: body.password },
    });
    await this.tdb.db.insert(tenantSignups).values({ tenantId, ipHash, consentVersion: SIGNUP_CONSENT_VERSION });
    return { ok: true };
  }

  private hashIp(ip: string | undefined) {
    return ip ? createHmac('sha256', this.config.jwtSecret).update(`signup:${ip}`).digest('hex').slice(0, 32) : null;
  }

  private async checkLimits(ipHash: string | null) {
    const since = (ms: number) => new Date(Date.now() - ms);
    const [{ n: today }] = (await this.tdb.db.select({ n: count() }).from(tenantSignups).where(gt(tenantSignups.createdAt, since(24 * HOUR)))) as [{ n: number }];
    if (today >= this.config.signupDailyLimit) throw tooMany();
    if (!ipHash) return;
    const [{ n }] = (await this.tdb.db
      .select({ n: count() })
      .from(tenantSignups)
      .where(and(eq(tenantSignups.ipHash, ipHash), gt(tenantSignups.createdAt, since(HOUR))))) as [{ n: number }];
    if (n >= HOURLY_LIMIT_PER_IP) throw tooMany();
  }
}

const tooMany = () => new HttpException({ code: 'TOO_MANY_SIGNUPS', message: 'Muitos cadastros seguidos. Tente de novo mais tarde.' }, HttpStatus.TOO_MANY_REQUESTS);

function normalizeDocument(input: string | undefined) {
  if (!input) return undefined;
  const digits = onlyDigits(input);
  if (digits.length === 11 && isValidCpf(digits)) return digits;
  const cnpj = normalizeCnpj(input);
  if (isValidCnpj(cnpj)) return cnpj;
  throw new BadRequestException({ code: 'INVALID_DOCUMENT', message: 'CNPJ ou CPF inválido' });
}
