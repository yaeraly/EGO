import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { user_role } from '@prisma/client';
import { ClientContext } from '../common/request-context';
import { burnVerifyTime, hashSecret, verifySecret } from '../common/secret-hash';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityEvent, SecurityLogService } from '../security/security-log.service';

export interface LoginResult {
  access_token: string;
  user: { id: string; full_name: string; role: user_role; phone: string | null };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly securityLog: SecurityLogService,
  ) {}

  /** Phone + password -> JWT. Every outcome lands in the Security Log. */
  async login(
    phone: string,
    password: string,
    ctx: ClientContext,
  ): Promise<LoginResult> {
    const user = await this.prisma.users.findUnique({
      where: { phone },
      select: {
        id: true,
        full_name: true,
        role: true,
        phone: true,
        status: true,
        password_hash: true,
      },
    });

    if (!user) {
      // Spend the same time as a real verification so a missing account is
      // indistinguishable from a wrong password.
      await burnVerifyTime(password);
      await this.securityLog.log(SecurityEvent.LOGIN_FAIL, ctx);
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordOk = await verifySecret(user.password_hash, password);

    // A departing employee is deactivated, not deleted (Security), so an
    // INACTIVE or BLOCKED account must not be able to log in.
    if (!passwordOk || user.status !== 'ACTIVE') {
      await this.securityLog.log(SecurityEvent.LOGIN_FAIL, {
        ...ctx,
        userId: user.id,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.securityLog.log(SecurityEvent.LOGIN_OK, {
      ...ctx,
      userId: user.id,
    });

    return {
      access_token: await this.jwt.signAsync({ sub: user.id }),
      user: {
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        phone: user.phone,
      },
    };
  }

  async logout(userId: string, ctx: ClientContext): Promise<void> {
    await this.securityLog.log(SecurityEvent.LOGOUT, { ...ctx, userId });
  }

  /**
   * Confirms the caller's PIN. Used inline by business flows that require it
   * (for example a sale above the PIN threshold), so a wrong PIN is a normal
   * answer — `{ valid: false }` — not an authentication error. Either outcome
   * is recorded in the Security Log.
   */
  async verifyPin(
    userId: string,
    pin: string,
    ctx: ClientContext,
  ): Promise<{ valid: boolean }> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { pin_hash: true },
    });

    const valid = user ? await verifySecret(user.pin_hash, pin) : false;

    await this.securityLog.log(
      valid ? SecurityEvent.PIN_OK : SecurityEvent.PIN_FAIL,
      { ...ctx, userId },
    );

    return { valid };
  }

  /** Self-service PIN change: the current PIN must be supplied. */
  async changeOwnPin(
    userId: string,
    currentPin: string,
    newPin: string,
    ctx: ClientContext,
  ): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { pin_hash: true },
    });

    const valid = user ? await verifySecret(user.pin_hash, currentPin) : false;
    if (!valid) {
      await this.securityLog.log(SecurityEvent.PIN_FAIL, { ...ctx, userId });
      throw new UnauthorizedException('Current PIN is incorrect');
    }

    await this.securityLog.log(SecurityEvent.PIN_OK, { ...ctx, userId });
    await this.prisma.users.update({
      where: { id: userId },
      data: { pin_hash: await hashSecret(newPin), updated_at: new Date() },
    });
  }
}
