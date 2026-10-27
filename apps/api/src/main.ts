import 'reflect-metadata';
import { configureHttp } from '@all/core';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: o webhook do WhatsApp confere a assinatura sobre o corpo original.
  const app = await NestFactory.create(AppModule.forRoot(), { rawBody: true });
  configureHttp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API em http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap();
