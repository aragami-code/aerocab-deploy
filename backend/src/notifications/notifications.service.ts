import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private fcmEnabled = false;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    if (admin.apps.length > 0) {
      this.fcmEnabled = true;
      return;
    }

    // Cherche le fichier service account (local ou via variable d'env)
    const serviceAccountPath = path.join(process.cwd(), 'firebase-service-account.json');
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;

    try {
      let credential: admin.credential.Credential;

      if (serviceAccountEnv) {
        // Render : clé en variable d'env JSON
        const parsed = JSON.parse(serviceAccountEnv);
        credential = admin.credential.cert(parsed);
      } else if (fs.existsSync(serviceAccountPath)) {
        // Local : fichier JSON
        credential = admin.credential.cert(serviceAccountPath);
      } else {
        this.logger.warn('Firebase service account non configuré — notifications désactivées');
        return;
      }

      admin.initializeApp({ credential });
      this.fcmEnabled = true;
      this.logger.log('Firebase Admin initialisé avec succès');
    } catch (e) {
      this.logger.error('Erreur initialisation Firebase Admin', e);
    }
  }

  async savePushToken(userId: string, token: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token },
    });
  }

  async sendToUser(userId: string, title: string, body: string, data?: Record<string, string>) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (!user?.fcmToken) return;
    await this.sendPush(user.fcmToken, title, body, data);
  }

  async sendPush(token: string, title: string, body: string, data?: Record<string, string>) {
    if (!this.fcmEnabled) {
      this.logger.warn('FCM non configuré — notification ignorée');
      return;
    }

    try {
      await admin.messaging().send({
        token,
        notification: { title, body },
        data: data ?? {},
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'aerogo24_default',
          },
        },
      });
      this.logger.log(`Notification envoyée à ${token.slice(0, 20)}...`);
    } catch (e: any) {
      // Token invalide ou expiré → on le supprime
      if (e?.errorInfo?.code === 'messaging/registration-token-not-registered') {
        this.logger.warn('Token FCM invalide, suppression');
        await this.prisma.user.updateMany({
          where: { fcmToken: token },
          data: { fcmToken: null },
        });
      } else {
        this.logger.error('Erreur envoi FCM', e?.message);
      }
    }
  }
}
