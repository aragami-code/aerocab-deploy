import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  IsIn,
  MinLength,
  MaxLength,
  ArrayMinSize,
  Min,
  Max,
} from 'class-validator';
import { VEHICLE_CATEGORIES } from './register-driver.dto';

export class UpdateDriverDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  vehicleBrand?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  vehicleModel?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  vehicleColor?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  vehiclePlate?: string;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2030)
  vehicleYear?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Au moins une langue est requise' })
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsString()
  @IsIn(VEHICLE_CATEGORIES, { message: 'Catégorie de véhicule invalide' })
  vehicleCategory?: string;
}
