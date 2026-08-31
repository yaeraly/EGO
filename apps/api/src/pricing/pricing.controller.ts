import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { DECIMAL_MESSAGE, DECIMAL_PATTERN } from '../common/decimal';
import { Prisma } from '@prisma/client';
import { WarehousesService } from '../warehouses/warehouses.service';
import { PriceSuggestion, PricingService } from './pricing.service';

class SuggestQueryDto {
  @IsUUID()
  product_id!: string;

  @IsUUID()
  customer_id!: string;

  @IsOptional()
  @IsUUID()
  warehouse_id?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: `qty ${DECIMAL_MESSAGE}` })
  qty?: string;
}

/** What the sale screen fills a price field with when a customer is chosen. */
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly warehouses: WarehousesService,
  ) {}

  @Get('suggest')
  async suggest(@Query() query: SuggestQueryDto): Promise<PriceSuggestion> {
    const warehouseId =
      query.warehouse_id ?? (await this.warehouses.main()).id;
    return this.pricing.suggest({
      productId: query.product_id,
      customerId: query.customer_id,
      warehouseId,
      qty: query.qty ? new Prisma.Decimal(query.qty) : undefined,
    });
  }
}
