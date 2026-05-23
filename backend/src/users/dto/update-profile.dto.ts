import { IsString, IsEmail, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Le nom doit faire au moins 2 caracteres' })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email invalide' })
  email?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'Numéro de téléphone invalide (format E.164 requis, ex: +237612345678)' })
  phone?: string;
}
