import { ZodPipe } from '@all/core';
import { ModuleRoute, Public, RequirePermission, requestContext } from '@all/module-sdk';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import {
  channelInput,
  leadAssignInput,
  leadInput,
  leadNoteInput,
  leadPatch,
  leadSources,
  leadStatuses,
  leadStatusInput,
  leadTaskInput,
  publicLeadInput,
  referrerInput,
  rewardInput,
  type ChannelInput,
  type LeadInput,
  type LeadPatch,
  type LeadStatusInput,
  type LeadTaskInput,
  type PublicLeadInput,
} from '../../contracts';
import { MODULE } from '../shared';
import { LeadChannelsService } from './channels.service';
import { LeadsService } from './leads.service';
import { PublicSimulatorService } from './public.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuery = z.object({
  status: z.enum(leadStatuses).optional(),
  source: z.enum(leadSources).optional(),
  /** 'none' = sem vendedor. */
  sellerId: z.string().uuid().or(z.literal('none')).optional(),
  q: z.string().max(100).optional(),
  open: z.enum(['1', 'true']).optional(),
});
const reportQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() }).refine((q) => !q.from || !q.to || q.from <= q.to, 'Período inválido');

@Controller('consortium')
@ModuleRoute(MODULE)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly channels: LeadChannelsService,
  ) {}

  @Get('leads')
  @RequirePermission('consortium.leads.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.leads.list({ ...q, open: !!q.open });
  }

  /** Cadastro manual e importação por planilha (uma linha por chamada). */
  @Post('leads')
  @RequirePermission('consortium.leads.manage')
  create(@Body(new ZodPipe(leadInput)) body: LeadInput) {
    return this.leads.create(body);
  }

  @Get('leads/:id')
  @RequirePermission('consortium.leads.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(id);
  }

  @Patch('leads/:id')
  @RequirePermission('consortium.leads.work')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leadPatch)) body: LeadPatch) {
    return this.leads.update(id, body);
  }

  @Post('leads/:id/status')
  @HttpCode(200)
  @RequirePermission('consortium.leads.work')
  status(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leadStatusInput)) body: LeadStatusInput) {
    return this.leads.setStatus(id, body);
  }

  @Post('leads/:id/assign')
  @HttpCode(200)
  @RequirePermission('consortium.leads.manage')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leadAssignInput)) body: z.infer<typeof leadAssignInput>) {
    return this.leads.assign(id, body.sellerId, 'manage');
  }

  /** Quem atende assume um lead sem vendedor. */
  @Post('leads/:id/claim')
  @HttpCode(200)
  @RequirePermission('consortium.leads.work')
  claim(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.assign(id, null, 'claim');
  }

  @Post('leads/:id/notes')
  @HttpCode(200)
  @RequirePermission('consortium.leads.work')
  note(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leadNoteInput)) body: z.infer<typeof leadNoteInput>) {
    return this.leads.addNote(id, body.text);
  }

  @Post('leads/:id/whatsapp')
  @HttpCode(200)
  @RequirePermission('consortium.leads.work')
  whatsapp(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.whatsapp(id);
  }

  @Post('leads/:id/tasks')
  @HttpCode(200)
  @RequirePermission('consortium.leads.work')
  addTask(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leadTaskInput)) body: LeadTaskInput) {
    return this.leads.addTask(id, body);
  }

  /** Cliente do lead (cadastro existente com o mesmo contato, ou novo), para vender a cota. */
  @Post('leads/:id/customer')
  @HttpCode(200)
  @RequirePermission('consortium.leads.work')
  customer(@Param('id', ParseUUIDPipe) id: string) {
    if (!requestContext.require().permissions?.has('core.customers.write')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Sem permissão para cadastrar clientes' });
    return this.leads.ensureCustomer(id);
  }

  @Post('leads/:id/reward')
  @HttpCode(200)
  @RequirePermission('consortium.leads.manage')
  reward(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rewardInput)) body: z.infer<typeof rewardInput>) {
    return this.leads.setReward(id, body);
  }

  /** Exclusão dos dados pessoais a pedido do titular (LGPD). */
  @Post('leads/:id/anonymize')
  @HttpCode(200)
  @RequirePermission('consortium.leads.manage')
  anonymize(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.anonymize(id);
  }

  @Get('lead-tasks')
  @RequirePermission('consortium.leads.read')
  tasks(@Query(new ZodPipe(z.object({ all: z.enum(['1', 'true']).optional() }))) q: { all?: string }) {
    return this.leads.tasks({ all: !!q.all });
  }

  @Post('lead-tasks/:id/done')
  @HttpCode(200)
  @RequirePermission('consortium.leads.work')
  taskDone(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.completeTask(id);
  }

  @Get('leads-report')
  @RequirePermission('consortium.leads.manage')
  report(@Query(new ZodPipe(reportQuery)) q: z.infer<typeof reportQuery>) {
    return this.leads.report(q);
  }

  @Get('referrers')
  @RequirePermission('consortium.leads.manage')
  referrers() {
    return this.leads.listReferrers();
  }

  @Post('referrers')
  @RequirePermission('consortium.leads.manage')
  createReferrer(@Body(new ZodPipe(referrerInput)) body: z.infer<typeof referrerInput>) {
    return this.leads.createReferrer(body);
  }

  @Patch('referrers/:id')
  @RequirePermission('consortium.leads.manage')
  updateReferrer(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ active: z.boolean() }))) body: { active: boolean }) {
    return this.leads.setReferrerActive(id, body.active);
  }

  @Get('lead-channels')
  @RequirePermission('consortium.leads.manage')
  listChannels() {
    return this.channels.list();
  }

  @Post('lead-channels')
  @RequirePermission('consortium.leads.manage')
  createChannel(@Body(new ZodPipe(channelInput)) body: ChannelInput) {
    return this.channels.save(null, body);
  }

  @Patch('lead-channels/:id')
  @RequirePermission('consortium.leads.manage')
  updateChannel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(channelInput)) body: ChannelInput) {
    return this.channels.save(id, body);
  }

  /** Lead de teste pelo mesmo caminho do webhook (dados fictícios). */
  @Post('lead-channels/:id/test')
  @HttpCode(200)
  @RequirePermission('consortium.leads.manage')
  testChannel(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.test(id);
  }
}

/** Simulador público (/consorcio/<slug>): sem login, com limite de requisições por IP. */
@Controller('public/consortium/:slug')
@Public()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicSimulatorController {
  constructor(private readonly simulator: PublicSimulatorService) {}

  @Get()
  info(@Param('slug') slug: string, @Query('ind') ref?: string) {
    return this.simulator.info(slug, typeof ref === 'string' ? ref.slice(0, 20) : undefined);
  }

  @Post('leads')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  submit(@Param('slug') slug: string, @Body(new ZodPipe(publicLeadInput)) body: PublicLeadInput) {
    return this.simulator.submit(slug, body, requestContext.get().ip);
  }
}

/** Webhooks de anúncios: Meta Lead Ads (um endereço para o app) e Google Ads (um por canal). */
@Controller('public/consortium-leads')
@SkipThrottle()
export class LeadWebhooksController {
  constructor(private readonly channels: LeadChannelsService) {}

  /** Verificação feita pela Meta ao cadastrar o webhook. */
  @Public()
  @Get('meta')
  verify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    const ok = this.channels.verifyMeta(mode, token, challenge);
    if (ok === null) throw new ForbiddenException();
    return ok;
  }

  @Public()
  @Post('meta')
  @HttpCode(200)
  async meta(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    const r = await this.channels.receiveMetaWebhook(req.rawBody ?? Buffer.from(''), signature, req.body ?? {});
    if (!r.ok && r.reason === 'config') throw new ServiceUnavailableException('Webhook de leads do Meta não configurado');
    if (!r.ok) throw new UnauthorizedException();
    return { queued: r.queued };
  }

  @Public()
  @Post('google/:channelId')
  @HttpCode(200)
  async google(@Param('channelId', ParseUUIDPipe) channelId: string, @Body() body: unknown) {
    const r = await this.channels.receiveGoogleWebhook(channelId, (body ?? {}) as Record<string, unknown>);
    if (!r.ok && r.reason === 'unknown') throw new NotFoundException();
    if (!r.ok && r.reason === 'key') throw new UnauthorizedException();
    if (!r.ok) throw new BadRequestException({ code: 'INVALID_LEAD', message: 'Lead sem lead_id' });
    return {};
  }
}
