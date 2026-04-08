import { IsString, IsNumber, IsBoolean, IsOptional, Length } from 'class-validator';

export class CreateAirportDto {
  @IsString()
  @Length(3, 3)
  iataCode: string;

  @IsString()
  @IsOptional()
  @Length(4, 4)
  icaoCode?: string;

  @IsString()
  name: string;

  @IsString()
  city: string;

  @IsString()
  country: string;

  @IsString()
  @Length(2, 2)
  countryCode: string;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateAirportDto {
  @IsString()
  @IsOptional()
  @Length(3, 3)
  iataCode?: string;

  @IsString()
  @IsOptional()
  @Length(4, 4)
  icaoCode?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  @Length(2, 2)
  countryCode?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
