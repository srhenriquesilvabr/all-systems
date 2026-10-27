import { RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ModuleSettingsService } from './module-settings.service';

/** Configurações dos módulos contratados (ex.: chave Pix). */
@Controller('modules')
export class ModulesController {
  constructor(private readonly settings: ModuleSettingsService) {}

  @Get(':key/settings')
  @RequirePermission('core.access.settings')
  get(@Param('key') key: string) {
    return this.settings.get(key);
  }

  @Put(':key/settings')
  @HttpCode(204)
  @RequirePermission('core.access.settings')
  save(@Param('key') key: string, @Body() body: unknown) {
    return this.settings.save(key, body);
  }
}
