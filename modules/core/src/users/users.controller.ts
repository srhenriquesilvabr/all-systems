import { RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { UsersService } from './users.service';

const inviteBody = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(120),
  roleIds: z.array(z.string().uuid()).default([]),
});

const updateBody = z
  .object({
    status: z.enum(['active', 'disabled']).optional(),
    roleIds: z.array(z.string().uuid()).optional(),
  })
  .refine((b) => b.status || b.roleIds, 'Nada para alterar');

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('core.users.read')
  list() {
    return this.users.list();
  }

  @Post('invite')
  @RequirePermission('core.users.manage')
  invite(@Body(new ZodPipe(inviteBody)) body: z.infer<typeof inviteBody>) {
    return this.users.invite(body);
  }

  @Patch(':membershipId')
  @HttpCode(204)
  @RequirePermission('core.users.manage')
  update(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodPipe(updateBody)) body: z.infer<typeof updateBody>,
  ) {
    return this.users.update(membershipId, body);
  }
}
