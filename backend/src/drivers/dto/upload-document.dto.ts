import { IsString, IsEnum } from 'class-validator';

export enum DocumentTypeEnum {
  CNI_FRONT = 'cni_front',
  CNI_BACK = 'cni_back',
  LICENSE = 'license',
  REGISTRATION = 'registration',
  VEHICLE_PHOTO = 'vehicle_photo',
}

export class UploadDocumentDto {
  @IsEnum(DocumentTypeEnum, {
    message:
      'Type de document invalide. Valeurs acceptees: cni_front, cni_back, license, registration, vehicle_photo',
  })
  type!: DocumentTypeEnum;

  @IsString()
  fileUrl!: string;
}
