import { IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class MatchForfaitDto {
  @IsString()
  airportCode!: string;

  @IsNumber()
  @Type(() => Number)
  destLat!: number;

  @IsNumber()
  @Type(() => Number)
  destLng!: number;

  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsString()
  bookingType?: string;
}
