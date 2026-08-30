import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(3, { message: 'phone is too short' })
  @MaxLength(32, { message: 'phone is too long' })
  phone!: string;

  // Validation messages deliberately never echo the submitted value.
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128, { message: 'password is too long' })
  password!: string;
}
