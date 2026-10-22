import 'reflect-metadata';
import { OutboxRelay } from '@all/core';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Processo de jobs assíncronos: entrega os eventos do outbox (e-mails, integrações).
 * Mesma imagem da API com outro entrypoint; em produção, outro serviço no ECS.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot());
  app.enableShutdownHooks();
  app.get(OutboxRelay).start(Number(process.env.OUTBOX_POLL_MS ?? 1000));
  Logger.log('Worker em execução', 'Bootstrap');
}

bootstrap();
