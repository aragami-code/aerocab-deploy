import { IsString, Length, MinLength, MaxLength } from 'class-validator';
import { PHONE_PREFIX_MAP } from '../../common/phone-country';

const VALID_COUNTRY_CODES = Object.values(PHONE_PREFIX_MAP);

export class CreateCountryChangeRequestDto {
  @IsString()
  @Length(2, 2, { message: 'Le code pays doit faire exactement 2 caractères (ex: FR, CM)' })
  requestedCountry: string;

  @IsString()
  @MinLength(20, { message: 'Veuillez expliquer la raison du changement (min 20 caractères)' })
  @MaxLength(500)
  reason: string;
}

export class ReviewCountryChangeRequestDto {
  @IsString()
  status: 'approved' | 'rejected';

  @IsString()
  @MaxLength(500)
  adminNote?: string;
}
