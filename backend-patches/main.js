"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const helmet_1 = __importDefault(require("helmet"));
const app_module_1 = require("./app.module");
const settings_service_1 = require("./settings/settings.service");
function bootstrap_cors() {
    const base = [
        /^https:\/\/.*\.vercel\.app$/, // tous les déploiements Vercel
        /^https:\/\/.*\.onrender\.com$/, // services Render entre eux
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
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { rawBody: true });
    // 0.B5 — Helmet: HTTP security headers
    app.use((0, helmet_1.default)());
    // 0.B7 — CORS strict: fail-fast if CORS_ORIGINS absent in production
    const allowedOrigins = bootstrap_cors();
    app.enableCors({
        origin: allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-App-Key'],
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    // 0.B8 — KYC documents: NO longer served as static assets.
    // Protected via GET /api/uploads/:filename (JwtAuthGuard) in UploadsController.
    // (removed: app.useStaticAssets)
    // 1.B1 — Fail fast si JWT_SECRET absent ou valeur par défaut détectée
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'aerogo24-dev-secret-change-in-production') {
        throw new Error('[STARTUP] JWT_SECRET non défini ou valeur par défaut détectée — arrêt immédiat');
    }
    // 1.B2 — Fail fast si test_mode_enabled=true en production
    if (process.env.NODE_ENV === 'production') {
        const settings = app.get(settings_service_1.SettingsService);
        const testMode = await settings.get('test_mode_enabled', 'false');
        if (testMode === 'true') {
            throw new Error('[STARTUP] test_mode_enabled=true interdit en NODE_ENV=production — arrêt immédiat');
        }
    }
    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`AeroGo 24 API running on port ${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map