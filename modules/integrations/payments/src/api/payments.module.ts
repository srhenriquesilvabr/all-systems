import { ModuleSettingsService, ZodPipe } from '@all/core';
import { ModuleRoute } from '@all/module-sdk';
import { BadRequestException, Body, Controller, HttpCode, Injectable, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import type { PaymentsSettings } from '../manifest';
import { buildPixPayload } from '../pix';

@Injectable()
export class PixService {
  constructor(private readonly settings: ModuleSettingsService) {}

  /** Código "copia e cola" para cobrar `amount`. A confirmação é feita por quem recebe. */
  async charge(amount: number, reference: string) {
    const s = await this.settings.getReal<PaymentsSettings>('integration.payments');
    if (!s.pixKey || !s.merchantName || !s.merchantCity) {
      throw new BadRequestException({ code: 'PIX_NOT_CONFIGURED', message: 'Configure a chave Pix da empresa em Configurações > Pix' });
    }
    return { payload: buildPixPayload({ key: s.pixKey, merchantName: s.merchantName, merchantCity: s.merchantCity, amount, txid: reference }), amount };
  }
}

const chargeBody = z.object({
  amount: z.coerce.number().positive().max(1_000_000).multipleOf(0.01),
  reference: z.string().trim().min(1).max(25),
});

@Controller('payments')
@ModuleRoute('integration.payments')
export class PaymentsController {
  constructor(private readonly pix: PixService) {}

  /** Gerar o QR não movimenta dinheiro: basta ter o módulo ativo. O registro do pagamento exige permissão. */
  @Post('pix')
  @HttpCode(200)
  charge(@Body(new ZodPipe(chargeBody)) body: z.infer<typeof chargeBody>) {
    return this.pix.charge(body.amount, body.reference);
  }
}

@Module({ controllers: [PaymentsController], providers: [PixService], exports: [PixService] })
export class PaymentsModule {}
