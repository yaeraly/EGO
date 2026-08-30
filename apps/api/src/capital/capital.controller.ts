import { Body, Controller, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { documents, investors, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CapitalService } from './capital.service';
import { CreateCapitalDto, CreateInvestorDto, UpdateInvestorDto } from './dto/capital.dto';
import { InvestorsService } from './investors.service';

/** Capital is the owner's business (§2). */
@Roles(user_role.OWNER)
@Controller()
export class CapitalController {
  constructor(
    private readonly capital: CapitalService,
    private readonly investors: InvestorsService,
  ) {}

  @Post('investors')
  createInvestor(
    @Body() dto: CreateInvestorDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<investors> {
    return this.investors.create(dto, user.id);
  }

  @Get('investors')
  findInvestors(
    @Query('include_inactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ): Promise<investors[]> {
    return this.investors.findAll(includeInactive ?? false);
  }

  @Get('investors/:id')
  findInvestor(@Param('id', ParseUUIDPipe) id: string): Promise<investors> {
    return this.investors.findOne(id);
  }

  @Patch('investors/:id')
  updateInvestor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvestorDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<investors> {
    return this.investors.update(id, dto, user.id);
  }

  /** Creates a DRAFT. Money arrives on POST /api/documents/:id/confirm. */
  @Post('capital')
  createCapital(
    @Body() dto: CreateCapitalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<documents> {
    return this.capital.create(dto, user.id);
  }
}
