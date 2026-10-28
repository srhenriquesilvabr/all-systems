import { ZodPipe } from '@all/core';
import { ModuleRoute, Public, RequireAnyPermission, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, Headers, HttpCode, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { administratorCatalog, connectionInput, manualStatusInput, proposalInput, simulationInput, type ConnectionInput, type ManualStatusInput, type ProposalInput, type SimulationInput } from '../contracts';
import { VENDOR_NOTES, VENDOR_PENDING_ITEMS, VendorAdapters } from './adapters';
import { BankingService } from './banking.service';
import { BankHttp, ManualProvider, RestProvider, SimulatedProvider } from './providers';

const listQuery = z.object({ sourceType: z.string().max(50).optional(), sourceId: z.string().uuid().optional(), customerId: z.string().uuid().optional() });
const statusBody = z.object({ status: z.enum(['contracted', 'cancelled']), message: z.string().trim().max(300).nullish() });

@Controller('banking')
@ModuleRoute('integration.banking')
export class BankingController {
  constructor(
    private readonly banking: BankingService,
    private readonly vendors: VendorAdapters,
  ) {}

  /** Catálogo de administradoras (referência) com a situação do adaptador próprio de cada uma. */
  @Get('catalog')
  @RequireAnyPermission('core.access.settings', 'integration.banking.simulate', 'integration.banking.propose')
  catalog() {
    return {
      administrators: administratorCatalog.map((a) => ({ ...a, vendorAdapter: this.vendors.isImplemented(a.key) ? 'implemented' : 'pending', vendorNotes: VENDOR_NOTES[a.key] ?? [] })),
      vendorPendingItems: VENDOR_PENDING_ITEMS,
    };
  }

  @Get('connections')
  @RequirePermission('core.access.settings')
  connections() {
    return this.banking.listConnections();
  }

  @Post('connections')
  @RequirePermission('core.access.settings')
  create(@Body(new ZodPipe(connectionInput)) body: ConnectionInput) {
    return this.banking.saveConnection(null, body);
  }

  @Patch('connections/:id')
  @RequirePermission('core.access.settings')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(connectionInput)) body: ConnectionInput) {
    return this.banking.saveConnection(id, body);
  }

  @Post('simulate')
  @HttpCode(200)
  @RequireAnyPermission('integration.banking.simulate', 'integration.banking.propose')
  simulate(@Body(new ZodPipe(simulationInput)) body: SimulationInput) {
    return this.banking.simulate(body);
  }

  @Get('consortium-plans')
  @RequireAnyPermission('integration.banking.simulate', 'integration.banking.propose')
  plans() {
    return this.banking.consortiumPlans();
  }

  @Get('proposals')
  @RequireAnyPermission('integration.banking.simulate', 'integration.banking.propose')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.banking.list(q);
  }

  @Post('proposals')
  @RequirePermission('integration.banking.propose')
  submit(@Body(new ZodPipe(proposalInput)) body: ProposalInput) {
    return this.banking.submit(body);
  }

  @Post('proposals/:id/refresh')
  @HttpCode(200)
  @RequirePermission('integration.banking.propose')
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.banking.refresh(id);
  }

  /** Resposta de instituição sem API (modo manual), registrada pela equipe. */
  @Post('proposals/:id/manual')
  @HttpCode(200)
  @RequirePermission('integration.banking.propose')
  registerManual(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(manualStatusInput)) body: ManualStatusInput) {
    return this.banking.registerManual(id, body);
  }

  @Post('proposals/:id/status')
  @HttpCode(200)
  @RequirePermission('integration.banking.propose')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(statusBody)) body: z.infer<typeof statusBody>) {
    return this.banking.setStatus(id, body.status, body.message);
  }
}

/** Avisos das instituições (status de proposta). Assinatura HMAC-SHA256 com o segredo da conexão. */
@Controller('public/banking/webhook')
@SkipThrottle()
export class BankingWebhookController {
  constructor(private readonly banking: BankingService) {}

  @Public()
  @Post(':connectionId')
  @HttpCode(200)
  async receive(@Param('connectionId', ParseUUIDPipe) connectionId: string, @Req() req: RawBodyRequest<Request>, @Headers('x-signature') signature?: string) {
    const result = await this.banking.webhook(connectionId, req.rawBody ?? Buffer.from(''), signature, req.body ?? {});
    if (!result.ok && result.reason === 'unknown') throw new NotFoundException();
    if (!result.ok) throw new UnauthorizedException();
    return { applied: result.applied };
  }
}

@Module({
  controllers: [BankingController, BankingWebhookController],
  providers: [BankingService, SimulatedProvider, RestProvider, ManualProvider, VendorAdapters, BankHttp],
  exports: [BankingService],
})
export class BankingModule {}
