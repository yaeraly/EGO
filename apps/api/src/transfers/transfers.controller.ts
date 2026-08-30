import { Body, Controller, Post } from '@nestjs/common';
import { documents } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateTransferDto } from './dto/transfer.dto';
import { TransfersService } from './transfers.service';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  /**
   * Creates a DRAFT transfer. Money moves on
   * POST /api/documents/:id/confirm.
   */
  @Post()
  create(
    @Body() dto: CreateTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.transfers.create(dto, user.id);
  }
}
