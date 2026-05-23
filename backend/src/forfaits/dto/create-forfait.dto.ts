import { IsString, IsNumber, IsOptional, IsBoolean, IsArray, IsIn, Min, Max } from 'class-validator';

export class CreateForfaitDto {
  @IsString()
  name!: string;

  @IsString()
  airportCode!: string;

  @IsString()
  destinationName!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minDistKm?: number;

  @IsNumber()
  @Min(0)
  maxDistKm!: number;

  @IsNumber()
  @Min(0)
  priceAmount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  countryCode!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleTypes?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(['ARRIVAL', 'DEPARTURE', 'INTERNATIONAL'], { each: true })
  bookingTypes?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  driverPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  companyPercent?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
