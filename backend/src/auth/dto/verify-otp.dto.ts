import { IsString, Matches, Length, IsOptional, IsIn } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'Phone must be in international format (e.g. +237612345678)',
  })
  phone!: string;

  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'OTP must contain only digits' })
  code!: string;

  /**
   * Optional intended role sent by the client app.
   * - "passenger" from the AeroGo 24 passenger app
   * - "driver" from the AeroGo 24 Pro driver app
   *
   * Used when creating a new user to assign the correct role.
   * Ignored for existing users (their role is already set).
   */
  @IsOptional()
  @IsString()
  @IsIn(['passenger', 'driver'], {
    message: 'intendedRole must be "passenger" or "driver"',
  })
  intendedRole?: 'passenger' | 'driver';
}
