import { Injectable, Logger } from '@nestjs/common';
import Expo, { ExpoPushMessage } from 'expo-server-sdk';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly expo = new Expo();
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  async savePushToken(userId: string, token: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token },
    });
  }

  async sendToUser(userId: string, title: string, body: string, data?: Record<string, unknown>) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (!user?.fcmToken) return;

    await this.sendPush(user.fcmToken, title, body, data);
  }

  async sendPush(token: string, title: string, body: string, data?: Record<string, unknown>) {
    if (!Expo.isExpoPushToken(token)) {
      this.logger.warn(`Token invalide: ${token}`);
      return;
    }

    const message: ExpoPushMessage = { to: token, title, body, data, sound: 'default' };

    try {
      const chunks = this.expo.chunkPushNotifications([message]);
      for (const chunk of chunks) {
        const receipts = await this.expo.sendPushNotificationsAsync(chunk);
        for (const receipt of receipts) {
          if (receipt.status === 'error') {
            this.logger.error(`Erreur push: ${receipt.message}`);
          }
        }
      }
    } catch (e) {
      this.logger.error('Erreur envoi notification', e);
    }
  }
}
