import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RidesGateway } from '../bookings/rides.gateway';

export type AdminNotifType =
  | 'user.signup'
  | 'user.profile_change'
  | 'user.account_deleted'
  | 'driver.register'
  | 'driver.submit_review'
  | 'driver.document_upload'
  | 'driver.country_change'
  | 'driver.withdrawal_request'
  | 'booking.scheduled'
  | 'booking.driver_offline'
  | 'booking.driver_noshow'
  | 'payment.capture_failed'
  | 'payment.payout_failed'
  | 'payment.initiation_failed'
  | 'receipt.max_retries'
  | 'kyc.submitted'
  | 'sos.alert'
  | 'report.new';

@Injectable()
export class AdminNotificationService {
  private readonly logger = new Logger(AdminNotificationService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private moduleRef: ModuleRef,
  ) {}

  async notify(type: AdminNotifType, title: string, body: string, data?: Record<string, any>) {
    try {
      const notif = await this.prisma.adminNotification.create({
        data: {
          type,
          title,
          body,
          data: data ?? {},
        },
      });

      try {
        const gw = this.moduleRef.get(RidesGateway, { strict: false });
        gw?.server?.to('admin:dashboard').emit('admin:notification', {
          id: notif.id, type, title, body, data, createdAt: notif.createdAt,
        });
      } catch { /* gateway not yet ready */ }

      const fcmData: Record<string, string> = {};
      if (data) {
        for (const [k, v] of Object.entries(data)) {
          fcmData[k] = String(v);
        }
      }
      fcmData.notificationType = type;

      void this.notifications.sendToAdmins(title, body, fcmData);
    } catch (err: any) {
      this.logger.error(`Failed to send admin notification (${type}): ${err.message}`);
    }
  }

  async getNotifications(page = 1, limit = 20, unreadOnly = false) {
    const where = unreadOnly ? { read: false } : {};
    const skip = (page - 1) * limit;
    const [data, total, unreadCount] = await Promise.all([
      this.prisma.adminNotification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.adminNotification.count({ where }),
      this.prisma.adminNotification.count({ where: { read: false } }),
    ]);
    return { data, total, page, limit, unreadCount };
  }

  async markAsRead(notificationId: string) {
    return this.prisma.adminNotification.update({
      where: { id: notificationId },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllAsRead() {
    return this.prisma.adminNotification.updateMany({
      where: { read: false },
      data: { read: true, readAt: new Date() },
    });
  }

  async getUnreadCount() {
    return this.prisma.adminNotification.count({ where: { read: false } });
  }
}
