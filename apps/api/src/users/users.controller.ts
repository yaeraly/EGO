import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { user_role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { ResetPinDto } from '../auth/dto/pin.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateStatusDto, UpdateUserDto } from './dto/update-user.dto';
import { PublicUser, UsersService } from './users.service';

/**
 * User administration — OWNER only (§2).
 *
 * There is no DELETE route: staff are deactivated through PATCH :id/status,
 * so their documents and audit trail stay attributable (Security).
 */
@Roles(user_role.OWNER)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto): Promise<PublicUser> {
    return this.users.create(dto);
  }

  @Get()
  findAll(): Promise<PublicUser[]> {
    return this.users.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.users.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<PublicUser> {
    return this.users.update(id, dto);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ): Promise<PublicUser> {
    return this.users.setStatus(id, dto.status);
  }

  @Patch(':id/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPinDto,
  ): Promise<void> {
    return this.users.resetPin(id, dto.new_pin);
  }
}
