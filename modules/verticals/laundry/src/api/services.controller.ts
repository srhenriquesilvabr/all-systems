import { ZodPipe } from '@all/core';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { serviceInput, serviceUpdate, type ServiceInput } from '../contracts';
import { LaundryServicesService } from './services.service';

@Controller('laundry/services')
@ModuleRoute('laundry')
export class LaundryServicesController {
  constructor(private readonly services: LaundryServicesService) {}

  /** Qualquer membro com a lavanderia ativa consulta o catálogo (é usado ao abrir uma OS). */
  @Get()
  list() {
    return this.services.list();
  }

  @Post()
  @RequirePermission('laundry.catalog.manage')
  create(@Body(new ZodPipe(serviceInput)) body: ServiceInput) {
    return this.services.create(body);
  }

  @Patch(':id')
  @RequirePermission('laundry.catalog.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(serviceUpdate)) body: Partial<ServiceInput>) {
    return this.services.update(id, body);
  }
}
