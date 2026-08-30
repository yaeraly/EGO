import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { user_role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  role: user_role;
  phone: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
