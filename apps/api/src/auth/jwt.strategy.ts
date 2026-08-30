import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UsersRepository } from '../users/users.repository';

export interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersRepository,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Role and status are read from the database on every request rather than
   * trusted from the token. A user demoted, deactivated or blocked mid-session
   * loses access on their next call — which is also how a "logout" takes
   * effect for a blocked account, since the reference schema has no token
   * revocation table.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findAuthContext(payload.sub);

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }

    return { id: user.id, role: user.role, phone: user.phone };
  }
}
