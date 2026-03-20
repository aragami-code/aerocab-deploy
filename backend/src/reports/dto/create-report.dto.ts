import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateReportDto {
  @IsString() @IsNotEmpty() reportedId: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
  @IsString() @IsOptional() conversationId?: string;
}
