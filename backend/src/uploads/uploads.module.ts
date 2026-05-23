import { Module } from '@nestjs/common';
import { UploadsController, TicketImagesController, ChatImagesController } from './uploads.controller';

@Module({
  controllers: [UploadsController, TicketImagesController, ChatImagesController],
})
export class UploadsModule {}
