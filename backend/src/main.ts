import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';
import { AppModule } from './app.module';

const UPLOAD_DIR = '/tmp/aerocab-uploads';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  app.useStaticAssets(UPLOAD_DIR, { prefix: '/uploads' });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`AeroCab API running on port ${port}`);
}

bootstrap();
