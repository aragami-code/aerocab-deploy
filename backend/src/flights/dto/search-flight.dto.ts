import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class SearchFlightDto {
  @IsString()
  @MinLength(3)
  @MaxLength(10)
  @Matches(/^[A-Z0-9]{2}\s?\d{1,4}$/, {
    message:
      'Format de vol invalide. Exemples: AF946, TK 1452, CM 302',
  })
  flightNumber!: string;
}
