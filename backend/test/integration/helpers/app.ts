import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { NotificationsService } from '../../../src/notifications/notifications.service';

let app: INestApplication | null = null;

export async function getApp(): Promise<INestApplication> {
  if (app) return app;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(NotificationsService)
    .useValue({
      sendSms: jest.fn().mockResolvedValue(undefined),
      sendPushNotification: jest.fn().mockResolvedValue(undefined),
      sendEmail: jest.fn().mockResolvedValue(undefined),
      sendPush: jest.fn().mockResolvedValue(undefined),
      sendToUser: jest.fn().mockResolvedValue(undefined),
      sendToAdmins: jest.fn().mockResolvedValue(undefined),
      savePushToken: jest.fn().mockResolvedValue(undefined),
    })
    .compile();

  app = moduleRef.createNestApplication();

  // Mirror main.ts: global prefix
  app.setGlobalPrefix('api');

  // Mirror main.ts: ValidationPipe options (whitelist + forbidNonWhitelisted + transform)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}

export async function closeApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
}
