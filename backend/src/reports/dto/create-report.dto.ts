import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateReportDto {
  @IsString() @IsOptional() reportedId?: string;   // userId du chauffeur signalé
  @IsString() @IsOptional() bookingId?: string;    // alternative : ID de réservation
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
  @IsString() @IsOptional() conversationId?: string;
}
