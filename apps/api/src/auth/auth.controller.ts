import { Body, Controller, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { clientContext } from '../common/request-context';
import { AuthService, LoginResult } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePinDto, VerifyPinDto } from './dto/pin.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginResult> {
    return this.auth.login(dto.phone, dto.password, clientContext(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.auth.logout(user.id, clientContext(req));
  }

  @Post('pin/verify')
  @HttpCode(HttpStatus.OK)
  verifyPin(
    @Body() dto: VerifyPinDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<{ valid: boolean }> {
    return this.auth.verifyPin(user.id, dto.pin, clientContext(req));
  }

  @Patch('pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePin(
    @Body() dto: ChangePinDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.auth.changeOwnPin(
      user.id,
      dto.current_pin,
      dto.new_pin,
      clientContext(req),
    );
  }
}
