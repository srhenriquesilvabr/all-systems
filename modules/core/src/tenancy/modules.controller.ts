import { ModuleRegistry, requestContext, RequirePermission } from '@all/module-sdk';
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ModuleSettingsService } from './module-settings.service';
import { TenancyService } from './tenancy.service';

/** O que uma empresa pode contratar: ramos (verticais) e módulos. O core já vem em toda empresa. */
const HIREABLE_LAYERS = new Set(['vertical', 'shared', 'integration']);

/** Catálogo de módulos e configurações dos módulos contratados (ex.: chave Pix). */
@Controller('modules')
export class ModulesController {
  constructor(
    private readonly settings: ModuleSettingsService,
    private readonly registry: ModuleRegistry,
    private readonly tenancy: TenancyService,
  ) {}

  /**
   * O que uma empresa pode contratar: ramos adicionais (as verticais: lavanderia, advocacia…),
   * integrações (Pix, WhatsApp, bancos) e recursos compartilhados (agenda, vendas e estoque…).
   */
  @Get('catalog')
  catalog() {
    return this.registry
      .all()
      .filter((m) => HIREABLE_LAYERS.has(m.layer))
      .map((m) => ({ key: m.key, name: m.name, layer: m.layer, description: m.description, icon: m.icon }));
  }

  /** Contratação pelo dono: ativa na hora o ramo ou módulo, com as dependências. */
  @Post(':key/activate')
  @HttpCode(200)
  async activate(@Param('key') key: string) {
    const ctx = requestContext.requireTenant();
    if (!ctx.isOwner) throw new ForbiddenException({ code: 'OWNER_ONLY', message: 'Só o dono da empresa pode contratar' });
    const manifest = this.registry.get(key);
    if (!manifest || !HIREABLE_LAYERS.has(manifest.layer)) throw new BadRequestException({ code: 'NOT_HIREABLE', message: 'Este item não está disponível para contratar' });
    return { enabled: await this.tenancy.enableModules(ctx.tenantId, [key], 'addon') };
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
