import { FinanceService, ZodPipe } from '@all/core';
import { ModuleRoute, Public, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  appointmentEditInput,
  appointmentInput,
  appointmentPaymentInput,
  appointmentRoomInput,
  appointmentRoomsQuery,
  appointmentSeriesInput,
  availabilityQuery,
  cancelSeriesInput,
  onlineBookingInput,
  onlineServicesInput,
  rescheduleInput,
  resourceInput,
  serviceInput,
  statusInput,
  timeOffInput,
  workingHoursInput,
  type AppointmentEditInput,
  type AppointmentInput,
  type AppointmentSeriesInput,
  type ResourceInput,
  type ServiceInput,
} from '../contracts';
import { BookingService } from './booking.service';
import { SchedulingService } from './scheduling.service';

const rangeQuery = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    resourceId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
  })
  .refine((q) => q.customerId || (q.from && q.to && q.from < q.to), 'Informe o período (from/to) ou o cliente');

@Controller('scheduling')
@ModuleRoute('shared.scheduling')
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly finance: FinanceService,
  ) {}

  @Get('resources')
  @RequirePermission('shared.scheduling.read')
  resources() {
    return this.scheduling.listResources();
  }

  @Post('resources')
  @RequirePermission('shared.scheduling.manage')
  createResource(@Body(new ZodPipe(resourceInput)) body: ResourceInput) {
    return this.scheduling.saveResource(null, body);
  }

  @Patch('resources/:id')
  @RequirePermission('shared.scheduling.manage')
  updateResource(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(resourceInput)) body: ResourceInput) {
    return this.scheduling.saveResource(id, body);
  }

  @Put('resources/:id/hours')
  @HttpCode(204)
  @RequirePermission('shared.scheduling.manage')
  hours(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(workingHoursInput)) body: z.infer<typeof workingHoursInput>) {
    return this.scheduling.setWorkingHours(id, body.hours);
  }

  @Get('time-off')
  @RequirePermission('shared.scheduling.read')
  timeOff(@Query(new ZodPipe(z.object({ from: z.coerce.date(), to: z.coerce.date() }))) q: { from: Date; to: Date }) {
    return this.scheduling.listTimeOff(q.from, q.to);
  }

  @Post('resources/:id/time-off')
  @RequirePermission('shared.scheduling.write')
  addTimeOff(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(timeOffInput)) body: z.infer<typeof timeOffInput>) {
    return this.scheduling.addTimeOff(id, body);
  }

  @Delete('time-off/:id')
  @HttpCode(204)
  @RequirePermission('shared.scheduling.write')
  removeTimeOff(@Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.removeTimeOff(id);
  }

  @Get('services')
  @RequirePermission('shared.scheduling.read')
  services() {
    return this.scheduling.listServices();
  }

  @Post('services')
  @RequirePermission('shared.scheduling.manage')
  createService(@Body(new ZodPipe(serviceInput)) body: ServiceInput) {
    return this.scheduling.saveService(null, body);
  }

  @Patch('services/:id')
  @RequirePermission('shared.scheduling.manage')
  updateService(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(serviceInput)) body: ServiceInput) {
    return this.scheduling.saveService(id, body);
  }

  /** O que fica liberado no link de agendamento online. */
  @Put('services/online')
  @HttpCode(204)
  @RequirePermission('shared.scheduling.manage')
  setOnlineServices(@Body(new ZodPipe(onlineServicesInput)) body: z.infer<typeof onlineServicesInput>) {
    return this.scheduling.setOnlineServices(body.serviceIds);
  }

  @Get('availability')
  @RequirePermission('shared.scheduling.read')
  availability(@Query(new ZodPipe(availabilityQuery)) q: z.infer<typeof availabilityQuery>) {
    return this.scheduling.availability(q);
  }

  @Get('appointments')
  @RequirePermission('shared.scheduling.read')
  list(@Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.scheduling.listAppointments({ from: q.from ?? new Date(0), to: q.to ?? new Date(8.64e15), resourceId: q.resourceId, customerId: q.customerId });
  }

  @Get('appointments/:id')
  @RequirePermission('shared.scheduling.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.get(id);
  }

  @Post('appointments')
  @RequirePermission('shared.scheduling.write')
  create(@Body(new ZodPipe(appointmentInput)) body: AppointmentInput) {
    return this.scheduling.create(body);
  }

  /** Horário com repetição: cria a série inteira e devolve o que não coube. */
  @Post('appointments/series')
  @RequirePermission('shared.scheduling.write')
  createSeries(@Body(new ZodPipe(appointmentSeriesInput)) body: AppointmentSeriesInput) {
    return this.scheduling.createSeries(body);
  }

  @Post('appointments/:id/cancel-series')
  @HttpCode(200)
  @RequirePermission('shared.scheduling.write')
  cancelSeries(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSeriesInput)) body: z.infer<typeof cancelSeriesInput>) {
    return this.scheduling.cancelSeries(id, body.reason);
  }

  @Post('appointments/:id/reschedule')
  @HttpCode(200)
  @RequirePermission('shared.scheduling.write')
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rescheduleInput)) body: z.infer<typeof rescheduleInput>) {
    return this.scheduling.reschedule(id, body);
  }

  /** Troca profissional, serviços, preço, desconto, sala ou observação de um horário ainda aberto. */
  @Patch('appointments/:id')
  @RequirePermission('shared.scheduling.write')
  edit(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(appointmentEditInput)) body: AppointmentEditInput) {
    return this.scheduling.editAppointment(id, body);
  }

  /** Salas que servem para o atendimento e se estão livres (no horário dele ou em `startsAt`). */
  @Get('appointments/:id/rooms')
  @RequirePermission('shared.scheduling.read')
  rooms(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(appointmentRoomsQuery)) q: z.infer<typeof appointmentRoomsQuery>) {
    return this.scheduling.roomOptions(id, q.startsAt);
  }

  /** Define, troca ou remove (roomId null) a sala de um atendimento já marcado. */
  @Put('appointments/:id/room')
  @RequirePermission('shared.scheduling.write')
  setRoom(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(appointmentRoomInput)) body: z.infer<typeof appointmentRoomInput>) {
    return this.scheduling.setRoom(id, body.roomId);
  }

  /** Atendimentos futuros que exigem sala e estão sem: recebem a primeira sala livre que serve. */
  @Post('rooms/distribute')
  @HttpCode(200)
  @RequirePermission('shared.scheduling.write')
  distributeRooms() {
    return this.scheduling.distributeRooms();
  }

  @Post('appointments/:id/status')
  @HttpCode(200)
  @RequirePermission('shared.scheduling.status')
  status(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(statusInput)) body: z.infer<typeof statusInput>) {
    return this.scheduling.setStatus(id, body.status, body.reason);
  }

  @Post('appointments/:id/payments')
  @RequirePermission('shared.scheduling.payments')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(appointmentPaymentInput)) body: z.infer<typeof appointmentPaymentInput>) {
    return this.scheduling.addPayment(id, body);
  }

  @Get('payment-accounts')
  @RequirePermission('shared.scheduling.payments')
  paymentAccounts() {
    return this.finance.listAccountsBasic();
  }

  /** Caixas do PDV com sessão aberta agora (vazio sem o módulo de vendas). */
  @Get('payment-registers')
  @RequirePermission('shared.scheduling.payments')
  paymentRegisters() {
    return this.scheduling.paymentRegisters();
  }
}

/** Agendamento online: rotas públicas, com limite de requisições por IP. */
@Controller('public/booking/:slug')
@Public()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicBookingController {
  constructor(private readonly booking: BookingService) {}

  @Get()
  info(@Param('slug') slug: string) {
    return this.booking.info(slug);
  }

  @Get('availability')
  availability(@Param('slug') slug: string, @Query(new ZodPipe(availabilityQuery)) q: z.infer<typeof availabilityQuery>) {
    return this.booking.availability(slug, q);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  book(@Param('slug') slug: string, @Body(new ZodPipe(onlineBookingInput)) body: z.infer<typeof onlineBookingInput>) {
    return this.booking.book(slug, body);
  }
}
