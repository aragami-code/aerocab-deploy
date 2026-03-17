import { IsString, IsEnum, IsOptional, MinLength } from 'class-validator';

export enum VerificationAction {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export class VerifyDriverDto {
  @IsEnum(VerificationAction)
  action!: VerificationAction;

  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'Le motif doit faire au moins 5 caracteres' })
  reason?: string;
}
