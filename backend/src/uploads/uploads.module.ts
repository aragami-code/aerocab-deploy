import { Module } from '@nestjs/common';
import {
  UploadsController,
  TicketImagesController,
  ChatImagesController,
  ApkUploadController,
  ApkController,
} from './uploads.controller';

@Module({
  controllers: [
    UploadsController,
    TicketImagesController,
    ChatImagesController,
    ApkUploadController,
    ApkController,
  ],
})
export class UploadsModule {}
