import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  MinLength,
  MaxLength,
  ArrayMinSize,
  Min,
  Max,
} from 'class-validator';

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
}
