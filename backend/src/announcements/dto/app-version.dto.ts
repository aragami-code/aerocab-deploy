import { IsString, IsOptional } from 'class-validator';

export class AppVersionDto {
  @IsOptional() @IsString() min_version_passenger?: string;
  @IsOptional() @IsString() latest_version_passenger?: string;
  @IsOptional() @IsString() apk_url_passenger?: string;
  @IsOptional() @IsString() min_version_driver?: string;
  @IsOptional() @IsString() latest_version_driver?: string;
  @IsOptional() @IsString() apk_url_driver?: string;
}
