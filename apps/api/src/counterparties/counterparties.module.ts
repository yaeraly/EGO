import { Module } from '@nestjs/common';
import {
  CargoCompaniesController,
  SuppliersController,
} from './counterparties.controller';
import {
  CargoCompaniesRepository,
  SuppliersRepository,
} from './counterparties.repository';
import {
  CargoCompaniesService,
  SuppliersService,
} from './counterparties.service';

@Module({
  controllers: [SuppliersController, CargoCompaniesController],
  providers: [
    SuppliersService,
    CargoCompaniesService,
    SuppliersRepository,
    CargoCompaniesRepository,
  ],
  exports: [SuppliersService, CargoCompaniesService],
})
export class CounterpartiesModule {}
