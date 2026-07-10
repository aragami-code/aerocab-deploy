import { IsString, IsOptional, IsEnum, IsArray, IsBoolean, IsDateString } from 'class-validator';

export class CreateAnnouncementDto {
  @IsEnum(['promo', 'info', 'ad']) type: 'promo' | 'info' | 'ad';
  @IsString() title: string;
  @IsString() body: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsEnum(['high', 'normal']) priority?: 'high' | 'normal';
  @IsOptional() @IsEnum(['none', 'screen', 'promo_code']) ctaType?: 'none' | 'screen' | 'promo_code';
  @IsOptional() @IsString() ctaLabel?: string;
  @IsOptional() @IsString() ctaValue?: string;
  @IsOptional() @IsArray() targetApps?: string[];
  @IsOptional() @IsArray() targetCountries?: string[];
  @IsOptional() @IsArray() targetTiers?: string[];
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
