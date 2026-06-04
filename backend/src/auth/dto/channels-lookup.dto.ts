import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class ChannelsLookupDto {
  // Identifiant = email OU numéro E.164. Validé au niveau ValidationPipe pour
  // éviter qu'un payload arbitraire atteigne Prisma (anti DTO-bypass).
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @Matches(/^(\+[1-9]\d{6,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/, {
    message: 'identifier doit être un email ou un numéro au format international (+237…)',
  })
  identifier!: string;
}
