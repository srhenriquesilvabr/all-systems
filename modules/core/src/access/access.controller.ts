import { RequirePermission } from '@all/module-sdk';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { AccessService } from './access.service';

const createRole = z.object({
  label: z.string().trim().min(2).max(60),
  permissions: z.array(z.string()).default([]),
});
const updateRole = createRole.partial();

@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('permissions')
  @RequirePermission('core.access.read')
  permissions() {
    return this.access.permissionCatalog();
  }

  @Get('roles')
  @RequirePermission('core.access.read')
  roles() {
    return this.access.listRoles();
  }

  @Post('roles')
  @RequirePermission('core.access.manage')
  create(@Body(new ZodPipe(createRole)) body: z.infer<typeof createRole>) {
    return this.access.createRole(body);
  }

  @Patch('roles/:id')
  @HttpCode(204)
  @RequirePermission('core.access.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateRole)) body: z.infer<typeof updateRole>) {
    return this.access.updateRole(id, body);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermission('core.access.manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.access.deleteRole(id);
  }
}
