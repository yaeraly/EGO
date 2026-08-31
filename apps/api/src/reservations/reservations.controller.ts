import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { documents, reservation_status } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CancelReservationDto, CreateReservationDto } from './dto/reservation.dto';
import { ReservationView, ReservationsViewService } from './reservations-view.service';
import { ReservationsService } from './reservations.service';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsEnum(reservation_status)
  status?: reservation_status;

  @IsOptional()
  @IsUUID()
  salesperson?: string;
}

/** Reservation (RSV) — §17. */
@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly view: ReservationsViewService,
  ) {}

  /** Creates a DRAFT. Confirming it is what holds the stock (§42.2). */
  @Post()
  create(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.reservations.create(dto, user.id, user.role);
  }

  @Get()
  findMany(@Query() query: ListQueryDto): Promise<ReservationView[]> {
    return this.view.list({
      customerId: query.customer_id,
      status: query.status,
      salesperson: query.salesperson,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ReservationView> {
    return this.view.one(id);
  }

  /** §17.2 — cancelled early, with the reason the audit keeps. */
  @Post(':id/cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelReservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReservationView> {
    await this.reservations.cancel(id, dto, user.id);
    return this.view.one(id);
  }
}
