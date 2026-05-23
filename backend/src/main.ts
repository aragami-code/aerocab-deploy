import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { SettingsService } from './settings/settings.service';

const UPLOAD_DIR = '/tmp/aerogo24-uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function bootstrap_cors(): (string | RegExp)[] {
  const base: (string | RegExp)[] = [
    /^https:\/\/.*\.vercel\.app$/,       // tous les déploiements Vercel
    /^https:\/\/.*\.onrender\.com$/,     // services Render entre eux
    'http://localhost:3000',
    'http://localhost:8080',
    'http://localhost:19006',
  ];
  const raw = process.env.CORS_ORIGINS;
  if (raw) {
    raw.split(',').map((o) => o.trim()).forEach((o) => base.push(o));
  }
  return base;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // 0.B5 — Helmet: HTTP security headers
  app.use(helmet());

  // 0.B7 — CORS strict: fail-fast if CORS_ORIGINS absent in production
  const allowedOrigins = bootstrap_cors();
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-App-Key'],
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 0.B8 — KYC documents: NO longer served as static assets.
  // Protected via GET /api/uploads/:filename (JwtAuthGuard) in UploadsController.
  // (removed: app.useStaticAssets)

  // 1.B1 — Fail fast si JWT_SECRET absent ou valeur par défaut détectée
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret === 'aerogo24-dev-secret-change-in-production') {
    throw new Error('[STARTUP] JWT_SECRET non défini ou valeur par défaut détectée — arrêt immédiat');
  }

  // 1.B2 — Avertissement si test_mode_enabled=true en production (non bloquant tant que SMS non configuré)
  if (process.env.NODE_ENV === 'production') {
    const settings = app.get(SettingsService);
    const testMode = await settings.get('test_mode_enabled', 'false');
    if (testMode === 'true') {
      console.warn('[STARTUP] ATTENTION : test_mode_enabled=true en production — désactiver dès que les SMS sont configurés');
    }
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`AeroGo 24 API running on port ${port}`);
}

bootstrap();
