import {
  IsString,
  IsOptional,
  IsDateString,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';

export enum ArrivalAirportEnum {
  DOUALA = 'DLA',
  YAOUNDE = 'NSI',
}

export class CreateFlightDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  flightNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  airline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  origin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  destination?: string;

  @IsEnum(ArrivalAirportEnum, {
    message: 'Aeroport invalide. Valeurs acceptees: DLA (Douala), NSI (Yaounde)',
  })
  arrivalAirport!: ArrivalAirportEnum;

  @IsDateString(
    {},
    { message: "Format de date invalide. Utilisez ISO 8601 (ex: 2026-03-15T14:30:00Z)" },
  )
  scheduledArrival!: string;

  @IsOptional()
  @IsEnum(['api', 'manual'] as const)
  source?: 'api' | 'manual';
}
