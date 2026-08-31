import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { documents } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CustomerPaymentsService } from './customer-payments.service';
import { CreateCustomerPaymentDto } from './dto/customer-payment.dto';

class ListQueryDto {
  @IsOptional()
  @IsUUID()
  customer_id?: string;
}

/** Customer payment (PAY) — §16-А. */
@Controller('customer-payments')
export class CustomerPaymentsController {
  constructor(private readonly payments: CustomerPaymentsService) {}

  /** Creates a DRAFT. Confirming it allocates and moves the money. */
  @Post()
  create(
    @Body() dto: CreateCustomerPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.payments.create(dto, user.id);
  }

  @Get()
  findMany(@Query() query: ListQueryDto) {
    return this.payments.findMany({ customerId: query.customer_id });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findOne(id);
  }

  /** Advances held for a customer, including from overpayments (§16-А.5). */
  @Get('customers/:customerId/advances')
  advances(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.payments.advancesFor(customerId);
  }
}
