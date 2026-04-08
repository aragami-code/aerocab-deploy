import { IsString, IsEnum, IsOptional, IsIn, MinLength } from 'class-validator';
import { VEHICLE_CATEGORIES } from '../../drivers/dto/register-driver.dto';

export enum VerificationAction {
  APPROVE = 'approve',
  REJECT = 'reject',
  SUSPEND = 'suspend',
}

export class VerifyDriverDto {
  @IsEnum(VerificationAction)
  action!: VerificationAction;

  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'Le motif doit faire au moins 5 caracteres' })
  reason?: string;

  @IsOptional()
  @IsString()
  @IsIn(VEHICLE_CATEGORIES, { message: 'Catégorie de véhicule invalide' })
  vehicleCategory?: string;
}
