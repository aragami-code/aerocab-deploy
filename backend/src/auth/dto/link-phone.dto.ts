import { IsString, IsNotEmpty, IsOptional, IsIn, Matches, Length } from 'class-validator';

const E164 = /^\+[1-9]\d{6,14}$/;

export class LinkPhoneSendDto {
  @IsString()
  @Matches(E164, { message: 'Numéro au format international requis (+237…)' })
  phone!: string;

  @IsOptional()
  @IsString()
  @IsIn(['sms', 'whatsapp'])
  channel?: 'sms' | 'whatsapp';
}

export class LinkPhoneVerifyDto {
  @IsString()
  @Matches(E164, { message: 'Numéro au format international requis (+237…)' })
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 8)
  code!: string;
}
