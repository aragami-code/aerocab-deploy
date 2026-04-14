import { IsString, IsOptional, IsIn, Matches } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'Phone must be in international format (e.g. +237612345678)',
  })
  phone!: string;

  @IsOptional()
  @IsString()
  @IsIn(['fr', 'en', 'zh', 'pidgin'])
  lang?: string;
}
