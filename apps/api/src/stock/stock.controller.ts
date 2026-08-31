import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { LayerView, ProductStock, StockService } from './stock.service';

class StockQueryDto {
  @IsOptional()
  @IsUUID()
  product_id?: string;

  @IsOptional()
  @IsUUID()
  warehouse_id?: string;
}

/** Read-only: stock is only ever changed by a document (§12-А.8.3). */
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  byProduct(@Query() query: StockQueryDto): Promise<ProductStock[]> {
    return this.stock.stockByProduct({
      productId: query.product_id,
      warehouseId: query.warehouse_id,
    });
  }

  /** Active layers of one product, each with its own cost (§12-Б.4, §18.1.3). */
  @Get('products/:id/layers')
  layers(@Param('id', ParseUUIDPipe) id: string): Promise<LayerView[]> {
    return this.stock.layersForProduct(id);
  }
}
