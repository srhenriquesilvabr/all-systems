import { ModuleRegistry, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ModuleSettingsService } from './module-settings.service';

/** Catálogo de módulos e configurações dos módulos contratados (ex.: chave Pix). */
@Controller('modules')
export class ModulesController {
  constructor(
    private readonly settings: ModuleSettingsService,
    private readonly registry: ModuleRegistry,
  ) {}

  /**
   * Setores e integrações que uma empresa pode contratar. Core e módulos compartilhados ficam
   * de fora: o core vem em toda empresa e os compartilhados chegam como dependência de um setor.
   */
  @Get('catalog')
  catalog() {
    return this.registry
      .all()
      .filter((m) => m.layer === 'vertical' || m.layer === 'integration')
      .map((m) => ({ key: m.key, name: m.name, layer: m.layer, description: m.description, icon: m.icon }));
  }

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
