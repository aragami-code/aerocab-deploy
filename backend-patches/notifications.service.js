"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var NotificationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const admin = __importStar(require("firebase-admin"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
let NotificationsService = NotificationsService_1 = class NotificationsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(NotificationsService_1.name);
        this.fcmEnabled = false;
    }
    onModuleInit() {
        var _a;
        if (admin.apps.length > 0) {
            this.fcmEnabled = true;
            return;
        }
        // 0.B20 — Priorité : vars individuelles → JSON complet → fichier local (à ne PAS commiter)
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const privateKey = (_a = process.env.FIREBASE_PRIVATE_KEY) === null || _a === void 0 ? void 0 : _a.replace(/\\n/g, '\n');
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
        const serviceAccountPath = path.join(process.cwd(), 'firebase-service-account.json');
        try {
            let credential;
            if (projectId && privateKey && clientEmail) {
                // Option 1 : 3 vars individuelles (recommandé)
                credential = admin.credential.cert({ projectId, privateKey, clientEmail });
            }
            else if (serviceAccountEnv) {
                // Option 2 : JSON complet en une seule var
                // Écriture dans un fichier temp car admin.credential.cert() interprète
                // une string comme un chemin de fichier (ENAMETOOLONG sinon)
                const parsed = typeof JSON.parse(serviceAccountEnv) === 'string'
                    ? JSON.parse(JSON.parse(serviceAccountEnv))
                    : JSON.parse(serviceAccountEnv);
                const tmpPath = path.join('/tmp', 'firebase-sa.json');
                fs.writeFileSync(tmpPath, JSON.stringify(parsed));
                credential = admin.credential.cert(tmpPath);
            }
            else if (fs.existsSync(serviceAccountPath)) {
                // Option 3 : fichier local — INTERDIT en production
                if (process.env.NODE_ENV === 'production') {
                    throw new Error('[FATAL] firebase-service-account.json détecté en production. ' +
                        'Utiliser FIREBASE_PROJECT_ID + FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL (env vars). ' +
                        'Supprimer le fichier du serveur immédiatement.');
                }
                this.logger.warn('[Security] firebase-service-account.json trouvé sur disque — à déplacer en env vars');
                credential = admin.credential.cert(serviceAccountPath);
            }
            else {
                this.logger.warn('Firebase service account non configuré — notifications désactivées');
                return;
            }
            admin.initializeApp({ credential });
            this.fcmEnabled = true;
            this.logger.log('Firebase Admin initialisé avec succès');
        }
        catch (e) {
            this.logger.error('Erreur initialisation Firebase Admin', e);
        }
    }
    async savePushToken(userId, token) {
        await this.prisma.user.update({
            where: { id: userId },
            data: { fcmToken: token },
        });
    }
    async sendToUser(userId, title, body, data) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { fcmToken: true },
        });
        if (!(user === null || user === void 0 ? void 0 : user.fcmToken))
            return;
        await this.sendPush(user.fcmToken, title, body, data);
    }
    async sendToAdmins(title, body, data) {
        const admins = await this.prisma.user.findMany({
            where: { role: 'admin', fcmToken: { not: null } },
            select: { fcmToken: true },
        });
        await Promise.allSettled(admins.map((a) => this.sendPush(a.fcmToken, title, body, data)));
    }
    async sendPush(token, title, body, data) {
        var _a;
        if (!this.fcmEnabled) {
            this.logger.warn('FCM non configuré — notification ignorée');
            return;
        }
        try {
            await admin.messaging().send({
                token,
                notification: { title, body },
                data: data !== null && data !== void 0 ? data : {},
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        channelId: 'aerogo24_default',
                    },
                },
            });
            this.logger.log(`Notification envoyée à ${token.slice(0, 20)}...`);
        }
        catch (e) {
            // Token invalide ou expiré → on le supprime
            if (((_a = e === null || e === void 0 ? void 0 : e.errorInfo) === null || _a === void 0 ? void 0 : _a.code) === 'messaging/registration-token-not-registered') {
                this.logger.warn('Token FCM invalide, suppression');
                await this.prisma.user.updateMany({
                    where: { fcmToken: token },
                    data: { fcmToken: null },
                });
            }
            else {
                this.logger.error('Erreur envoi FCM', e === null || e === void 0 ? void 0 : e.message);
            }
        }
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = NotificationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NotificationsService);
//# sourceMappingURL=notifications.service.js.map