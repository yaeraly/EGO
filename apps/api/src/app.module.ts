import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AccountsModule } from './accounts/accounts.module';
import { AuditModule } from './audit/audit.module';
import { BusinessDaysModule } from './business-days/business-days.module';
import { CapitalModule } from './capital/capital.module';
import { CurrencyModule } from './currency/currency.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DocumentsModule } from './documents/documents.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { SecurityLogModule } from './security/security-log.module';
import { SettingsModule } from './settings/settings.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { TransfersModule } from './transfers/transfers.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SecurityLogModule,
    AuditModule,
    BusinessDaysModule,
    AuthModule,
    UsersModule,
    DocumentsModule,
    AccountsModule,
    TransfersModule,
    CurrencyModule,
    CapitalModule,
    WithdrawalsModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Authentication is the default: a route opts out with @Public(),
    // never the other way round.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
