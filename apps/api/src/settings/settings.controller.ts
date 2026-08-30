import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { Prisma, settings, user_role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PutSettingDto } from './dto/setting.dto';
import { SettingsService } from './settings.service';

/** Global parameters — OWNER only. */
@Roles(user_role.OWNER)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  findAll(): Promise<settings[]> {
    return this.settings.findAll();
  }

  @Get(':key')
  findOne(@Param('key') key: string): Promise<settings> {
    return this.settings.findOne(key);
  }

  @Put(':key')
  put(
    @Param('key') key: string,
    @Body() dto: PutSettingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<settings> {
    return this.settings.put(
      key,
      dto.value as Prisma.InputJsonValue | null,
      dto.description,
      user.id,
    );
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('key') key: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.settings.remove(key, user.id);
  }
}
