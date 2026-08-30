import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface ClientContext {
  device: string | null;
  ip: string | null;
}

/** Device and IP for the Security Log. Never touches the request body. */
export function clientContext(req: Request): ClientContext {
  return {
    device: req.get('user-agent') ?? null,
    ip: req.ip ?? null,
  };
}

export function clientContextOf(ctx: ExecutionContext): ClientContext {
  return clientContext(ctx.switchToHttp().getRequest<Request>());
}
