import { IsString, IsNotEmpty, MaxLength, IsInt, Min, Max, IsOptional } from 'class-validator';

export class CreatePromoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @IsInt()
  @Min(1)
  @Max(100)
  discount: number;

  @IsInt()
  @Min(1)
  maxUses: number;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}
