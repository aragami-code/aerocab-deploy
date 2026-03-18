import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';

export class CreateBookingDto {
  @IsString()
  vehicleType!: string;

  @IsString()
  paymentMethod!: string;

  @IsString()
  departureAirport!: string;

  @IsString()
  destination!: string;

  @IsNumber()
  estimatedPrice!: number;

  @IsOptional()
  @IsString()
  flightNumber?: string;
}
