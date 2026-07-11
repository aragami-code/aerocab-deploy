import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const HEX = /^#[0-9A-Fa-f]{6}$/;

export class UpdateBrandingDto {
  @IsOptional() @IsString() @Matches(HEX, { message: 'primaryColor doit être #RRGGBB' })
  primaryColor?: string;

  @IsOptional() @IsString() @Matches(HEX, { message: 'accentColor doit être #RRGGBB' })
  accentColor?: string;

  @IsOptional() @IsString()
  paletteId?: string | null;

  @IsOptional() @IsString()
  logoUrl?: string | null;

  @IsOptional() @IsString() @MaxLength(40)
  appNamePassenger?: string;

  @IsOptional() @IsString() @MaxLength(40)
  appNameDriver?: string;
}
