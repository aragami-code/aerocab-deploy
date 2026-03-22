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

export const VEHICLE_CATEGORIES = ['eco', 'eco_plus', 'standard', 'confort', 'confort_plus'] as const;
export type VehicleCategory = typeof VEHICLE_CATEGORIES[number];

export class RegisterDriverDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  vehicleBrand!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  vehicleModel!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  vehicleColor!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(20)
  vehiclePlate!: string;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2030)
  vehicleYear?: number;

  @IsOptional()
  @IsString()
  @IsIn(VEHICLE_CATEGORIES, { message: 'Catégorie de véhicule invalide' })
  vehicleCategory?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Au moins une langue est requise' })
  @IsString({ each: true })
  languages!: string[];
}
