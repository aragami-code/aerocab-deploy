import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SmartSmsRouter } from '../sms/smart-sms.router';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);

  constructor(
    private prisma: PrismaService,
    private sms: SmartSmsRouter,
    private notifications: NotificationsService,
    private audit: AuditService,
  ) {}

  // ── Contacts d'urgence ───────────────────────────────────────────────────────

  async getContacts(userId: string) {
    return this.prisma.emergencyContact.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addContact(userId: string, dto: { name: string; phone: string; relation?: string }) {
    const count = await this.prisma.emergencyContact.count({ where: { userId } });
    if (count >= 3) throw new Error('Maximum 3 contacts d\'urgence autorisés');
    return this.prisma.emergencyContact.create({
      data: { userId, name: dto.name, phone: dto.phone, relation: dto.relation },
    });
  }

  async updateContact(userId: string, contactId: string, dto: { name?: string; phone?: string; relation?: string }) {
    const contact = await this.prisma.emergencyContact.findFirst({ where: { id: contactId, userId } });
    if (!contact) throw new NotFoundException('Contact introuvable');
    return this.prisma.emergencyContact.update({ where: { id: contactId }, data: dto });
  }

  async deleteContact(userId: string, contactId: string) {
    const contact = await this.prisma.emergencyContact.findFirst({ where: { id: contactId, userId } });
    if (!contact) throw new NotFoundException('Contact introuvable');
    await this.prisma.emergencyContact.delete({ where: { id: contactId } });
    return { success: true };
  }

  // ── Déclenchement SOS ────────────────────────────────────────────────────────

  async triggerSos(userId: string, payload: {
    bookingId?: string;
    lat?: number;
    lng?: number;
    audioUrl?: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true, emergencyContacts: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const mapsLink = payload.lat && payload.lng
      ? `https://maps.google.com/?q=${payload.lat},${payload.lng}`
      : null;

    // SMS à chaque contact d'urgence
    const smsPromises = user.emergencyContacts.map(contact => {
      const msg = [
        `🚨 ALERTE SOS — ${user.name ?? user.phone}`,
        `a déclenché une alerte depuis AeroGo 24.`,
        mapsLink ? `Position GPS : ${mapsLink}` : null,
        `Appelez-le(la) immédiatement ou contactez le 117.`,
      ].filter(Boolean).join('\n');

      return this.sms.send(contact.phone, msg).catch(err => {
        this.logger.warn(`SMS SOS échoué vers ${contact.phone}: ${err.message}`);
      });
    });

    await Promise.allSettled(smsPromises);

    // Notif push admin
    this.notifications.sendToAdmins(
      '🚨 Alerte SOS passager',
      `${user.name ?? user.phone} a déclenché un SOS${mapsLink ? ` — ${mapsLink}` : ''}`,
    ).catch(() => {});

    // Audit
    await this.audit.log({
      action: 'sos.triggered',
      entity: 'user',
      entityId: userId,
      userId,
      meta: { bookingId: payload.bookingId, lat: payload.lat, lng: payload.lng, hasAudio: !!payload.audioUrl },
    }).catch(() => {});

    this.logger.warn(`SOS déclenché par user ${userId} — contacts notifiés: ${user.emergencyContacts.length}`);

    return {
      success: true,
      contactsNotified: user.emergencyContacts.length,
      mapsLink,
    };
  }

  // ── Upload audio SOS ─────────────────────────────────────────────────────────

  async saveAudioUrl(userId: string, bookingId: string | undefined, audioUrl: string) {
    this.logger.warn(`Audio SOS enregistré: user=${userId} booking=${bookingId} url=${audioUrl}`);
    await this.audit.log({
      action: 'sos.audio_uploaded',
      entity: 'user',
      entityId: userId,
      userId,
      meta: { bookingId, audioUrl },
    }).catch(() => {});
    return { success: true, audioUrl };
  }
}
