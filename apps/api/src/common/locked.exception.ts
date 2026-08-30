import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 423 Locked — the target period is closed.
 *
 * Distinct from 409: the request is not in conflict with the resource's state,
 * the resource is sealed. A caller can tell "your document is already
 * confirmed" from "that day is closed, book it elsewhere or raise a
 * correction".
 */
export class LockedException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.LOCKED);
  }
}
