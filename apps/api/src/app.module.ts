import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { SecurityLogModule } from './security/security-log.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SecurityLogModule,
    AuthModule,
    UsersModule,
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
