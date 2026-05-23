import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RidesGateway } from './rides.gateway';
import { SettingsService } from '../settings/settings.service';
import { PointsService } from '../points/points.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { FlutterwaveService } from '../payments/flutterwave.service';
import { DispatchService } from './dispatch.service';
import { PayoutService } from '../payments/payout.service';
import { ReceiptService } from '../payments/receipt.service';

@Injectable()
export class BookingsScheduler {
  private readonly logger = new Logger(BookingsScheduler.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private ridesGateway: RidesGateway,
    private settingsService: SettingsService,
    private points: PointsService,
    private audit: AuditService,
    private redis: RedisService,
    private flutterwave: FlutterwaveService,
    private dispatch: DispatchService,
    private payout: PayoutService,
    private receiptSvc: ReceiptService,
  ) {}

  /**
   * F5.3 — Toutes les minutes : retry les reçus de course qui ont échoué.
   * Settings : `receipt_max_attempts` (défaut 5), `receipt_backoff_minutes` (défaut 2).
   * Backoff exponentiel simple : skip si updatedAt < now - attempts * backoff_min.
   */
  @Cron('* * * * *')
  async processReceiptJobs() {
    const maxRaw = await this.settingsService.get('receipt_max_attempts', '5');
    const backoffRaw = await this.settingsService.get('receipt_backoff_minutes', '2');
    const maxAttempts = parseInt(maxRaw, 10) || 5;
    const backoffMin = parseInt(backoffRaw, 10) || 2;

    const jobs = await this.prisma.receiptJob.findMany({
      where: { status: 'pending', attempts: { lt: maxAttempts } },
      take: 10,
      orderBy: { updatedAt: 'asc' },
    });

    for (const job of jobs) {
      // Backoff : on ne retry qu'après attempts * backoffMin minutes
      const elapsedMin = (Date.now() - job.updatedAt.getTime()) / 60000;
      if (elapsedMin < job.attempts * backoffMin) continue;

      try {
        await this.receiptSvc.sendRideReceipt(job.bookingId);
        await this.prisma.receiptJob.update({
          where: { id: job.id },
          data: { status: 'sent', updatedAt: new Date() },
        });
        this.logger.log(`[Receipt] retry ok booking=${job.bookingId} attempts=${job.attempts + 1}`);
      } catch (err: any) {
        const nextAttempts = job.attempts + 1;
        const nextStatus = nextAttempts >= maxAttempts ? 'failed' : 'pending';
        await this.prisma.receiptJob.update({
          where: { id: job.id },
          data: { attempts: nextAttempts, status: nextStatus, lastError: err?.message?.slice(0, 500), updatedAt: new Date() },
        });
        if (nextStatus === 'failed') {
          this.logger.error(`[Receipt] max attempts reached booking=${job.bookingId} — escalation requise`);
          this.audit.log({
            action: 'receipt.escalation',
            entity: 'booking',
            entityId: job.bookingId,
            meta: { attempts: nextAttempts, lastError: err?.message },
          }).catch(() => {});
        }
      }
    }
  }

  /**
   * D3.4 — Toutes les 30 secondes : réassigne les bookings dont le driver
   * assigné n'a ni accepté ni refusé après `accept_timeout_seconds` (défaut 60s).
   * Évite que le passager attende indéfiniment un driver qui ne répond pas.
   */
  @Cron('*/30 * * * * *')
  async reassignUnacceptedBookings() {
    const raw = await this.settingsService.get('accept_timeout_seconds', '60');
    const timeoutSec = parseInt(raw, 10) || 60;
    const cutoff = new Date(Date.now() - timeoutSec * 1000);

    // Bookings encore pending avec un driver assigné dont l'updatedAt est antérieur au cutoff
    const stalled = await this.prisma.booking.findMany({
      where: {
        status: 'pending',
        driverProfileId: { not: null },
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        passengerId: true,
        destination: true,
        vehicleType: true,
        departureAirport: true,
        pickupLat: true,
        pickupLng: true,
        type: true,
        flightNumber: true,
        estimatedPrice: true,
        driverProfileId: true,
      },
      take: 20,
    });

    if (stalled.length === 0) return;

    this.logger.warn(`[D3.4] ${stalled.length} booking(s) sans réponse driver après ${timeoutSec}s — re-dispatch`);

    for (const booking of stalled) {
      try {
        const previousDriverId = booking.driverProfileId!;
        const coords = (booking.pickupLat && booking.pickupLng)
          ? { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) }
          : undefined;
        // Recherche d'un autre driver, en excluant celui qui n'a pas répondu
        const nextDriver = await this.dispatch.findEligibleDrivers(
          booking as any,
          false,
          coords,
        ).then((list: any[]) => list.find((d) => d.id !== previousDriverId) ?? null);

        if (nextDriver) {
          await this.prisma.booking.update({
            where: { id: booking.id },
            data: { driverProfileId: nextDriver.id },
          });
          this.ridesGateway.server.to(`driver:${nextDriver.id}`).emit('booking:new_request', {
            id: booking.id,
            passengerId: booking.passengerId,
            flightNumber: booking.flightNumber,
            destination: booking.destination,
            vehicleType: booking.vehicleType,
            estimatedPrice: booking.estimatedPrice,
            departureAirport: booking.departureAirport,
          });
          await this.notifications.sendToUser(
            nextDriver.userId,
            'Nouvelle course 🚗',
            `Course vers ${booking.destination}`,
          ).catch(() => {});
          this.ridesGateway.server
            .to(`passenger:${booking.passengerId}`)
            .emit('booking_status_changed', { id: booking.id, status: 'pending' });
        } else {
          // Aucun autre driver → libère le booking (le cron 2-min finira de l'expirer)
          await this.prisma.booking.update({
            where: { id: booking.id },
            data: { driverProfileId: null },
          });
        }

        await this.audit.log({
          action: 'booking.reassigned_on_timeout',
          entity: 'booking',
          entityId: booking.id,
          meta: { previousDriverId, nextDriverId: nextDriver?.id ?? null, timeoutSec },
        }).catch(() => {});
      } catch (e: any) {
        this.logger.error(`[D3.4] Re-dispatch ${booking.id} échoué: ${e.message}`);
      }
    }
  }

  /**
   * Toutes les 2 minutes : expire les bookings en `pending` sans driver
   * depuis plus de DRIVER_ASSIGNMENT_TIMEOUT_MIN minutes.
   */
  @Cron('*/2 * * * *')
  async expireUnassignedBookings() {
    // 0.B13 — timeout lu depuis AppSetting (défaut 2 min depuis suppression setTimeout)
    const raw = await this.settingsService.get('booking_assignment_timeout_min', '2');
    const timeoutMin = parseInt(raw, 10) || 2;
    const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);

    const expired = await this.prisma.booking.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        passengerId: true,
        destination: true,
        paymentMethod: true,
        estimatedPrice: true,
        driverProfile: { select: { id: true, userId: true } },
      },
    });

    if (expired.length === 0) return;

    this.logger.warn(`[Scheduler] ${expired.length} booking(s) expirés (pas de driver en ${timeoutMin}min)`);

    // H4 — Annulation + remboursement atomique par booking (transaction individuelle)
    for (const booking of expired) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: booking.id },
            data: { status: 'cancelled' },
          });

          const price = Math.ceil(booking.estimatedPrice as number);
          if (
            (booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points') &&
            price > 0
          ) {
            await tx.pointsTransaction.create({
              data: {
                userId: booking.passengerId,
                type: 'credit',
                points: price,
                label: `Remboursement expiration course ${booking.id.slice(0, 8)}`,
              },
            });
            await tx.wallet.upsert({
              where: { userId: booking.passengerId },
              update: { balance: { increment: price } },
              create: { userId: booking.passengerId, balance: price },
            });
          }
        });

        // Notifications hors-transaction (non-critiques)
        await this.notifications.sendToUser(
          booking.passengerId,
          'Aucun chauffeur disponible',
          `Votre course vers ${booking.destination} a été annulée — aucun chauffeur trouvé en ${timeoutMin} minutes.`,
        ).catch(() => {});
        this.ridesGateway.server
          .to(`passenger:${booking.passengerId}`)
          .emit('booking:expired', { id: booking.id, reason: 'no_driver' });

        if ((booking as any).driverProfile?.userId) {
          const driverUserId = (booking as any).driverProfile.userId;
          const driverProfileId = (booking as any).driverProfile.id;
          await this.notifications.sendToUser(
            driverUserId,
            'Course expirée',
            `Une course vous avait été assignée mais le délai d'attribution est dépassé.`,
          ).catch(() => {});
          this.ridesGateway.server
            .to(`driver:${driverProfileId}`)
            .emit('booking:expired', { id: booking.id, reason: 'assignment_timeout' });
        }
      } catch (e: any) {
        this.logger.error(`[Scheduler] Expiration booking ${booking.id} échouée: ${e.message}`);
      }
    }
  }

  /**
   * S221 — Toutes les 5 minutes : détecter les chauffeurs offline pendant une course active.
   * Un driver est considéré offline si isOnline=false ou lastActive > 10 min.
   * Alerte admin via audit log.
   */
  @Cron('*/5 * * * *')
  async detectOfflineDriversDuringRide() {
    const threshold = new Date(Date.now() - 10 * 60 * 1000); // 10 min sans activité

    const stuckBookings = await this.prisma.booking.findMany({
      where: {
        status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] },
        driverProfile: {
          OR: [
            { isOnline: false },
            { lastActive: { lt: threshold } },
          ],
        },
      },
      select: {
        id: true,
        passengerId: true,
        destination: true,
        status: true,
        driverProfile: {
          select: { id: true, userId: true, isOnline: true, lastActive: true },
        },
      },
    });

    for (const booking of stuckBookings) {
      const driver = booking.driverProfile;
      if (!driver) continue;

      this.logger.warn(
        `[S221] Driver ${driver.userId} offline pendant course ${booking.id} (status: ${booking.status}, lastActive: ${driver.lastActive?.toISOString() ?? 'jamais'})`,
      );

      await this.audit.log({
        action: 'driver.offline_during_ride',
        entity: 'booking',
        entityId: booking.id,
        userId: driver.userId,
        meta: {
          bookingStatus: booking.status,
          driverProfileId: driver.id,
          isOnline: driver.isOnline,
          lastActive: driver.lastActive,
          passengerId: booking.passengerId,
        },
      }).catch(() => {});
    }
  }

  /**
   * S222 — Toutes les 5 minutes : annuler les bookings `confirmed` où le chauffeur
   * ne s'est pas présenté dans le délai `driver_noshow_timeout_min` (défaut 30 min).
   * Remboursement 100% passager + alerte admin via audit log.
   */
  @Cron('*/5 * * * *')
  async handleDriverNoShow() {
    const raw = await this.settingsService.get('driver_noshow_timeout_min', '30');
    const timeoutMin = parseInt(raw, 10) || 30;
    const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);

    const stale = await this.prisma.booking.findMany({
      where: {
        status: 'confirmed',
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        passengerId: true,
        destination: true,
        paymentMethod: true,
        estimatedPrice: true,
        driverProfile: { select: { id: true, userId: true } },
      },
    });

    if (stale.length === 0) return;

    this.logger.warn(`[Scheduler] ${stale.length} booking(s) no-show chauffeur (>${timeoutMin}min en confirmed)`);

    for (const booking of stale) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const updated = await tx.booking.updateMany({
            where: { id: booking.id, status: 'confirmed' },
            data: { status: 'cancelled', cancelledAt: new Date() },
          });
          if (updated.count === 0) return; // déjà traité

          if (
            (booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points') &&
            Number(booking.estimatedPrice) > 0
          ) {
            await tx.pointsTransaction.create({
              data: {
                userId: booking.passengerId,
                type: 'credit',
                points: Math.ceil(Number(booking.estimatedPrice)),
                label: `Remboursement no-show chauffeur — course ${booking.id.slice(0, 8)}`,
              },
            });
          }
        });

        this.ridesGateway.server
          .to(`passenger:${booking.passengerId}`)
          .emit('booking:cancelled', { bookingId: booking.id, reason: 'driver_noshow' });

        await this.notifications.sendToUser(
          booking.passengerId,
          'Chauffeur non présenté',
          `Votre course vers ${booking.destination} a été annulée — le chauffeur ne s'est pas présenté. Vous avez été remboursé intégralement.`,
        ).catch(() => {});

        if (booking.driverProfile?.userId) {
          await this.notifications.sendToUser(
            booking.driverProfile.userId,
            'Course annulée — no-show',
            `La course ${booking.id.slice(0, 8)} a été annulée automatiquement pour non-présentation.`,
          ).catch(() => {});
        }

        await this.audit.log({
          action: 'booking.driver_noshow',
          entity: 'booking',
          entityId: booking.id,
          userId: booking.driverProfile?.userId,
          meta: { timeoutMin, passengerId: booking.passengerId, refunded: true },
        }).catch(() => {});

        this.logger.log(`[Scheduler] Booking ${booking.id} annulé no-show, passager ${booking.passengerId} remboursé`);
      } catch (e: any) {
        this.logger.error(`[Scheduler] No-show handler échoué pour ${booking.id}: ${e.message}`);
      }
    }
  }

  /**
   * 5.B4 — Toutes les minutes : auto-compléter les bookings `passenger_confirming`
   * si le passager n'a pas confirmé dans le délai `passenger_confirm_timeout_min` (défaut 5 min).
   */
  @Cron('* * * * *')
  async autoCompletePassengerConfirming() {
    const raw = await this.settingsService.get('passenger_confirm_timeout_min', '5');
    const timeoutMin = parseInt(raw, 10) || 5;
    const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);

    const pending = await this.prisma.booking.findMany({
      where: {
        status: 'passenger_confirming' as any,
        completedAt: { lt: cutoff },
      },
      select: {
        id: true,
        passengerId: true,
        destination: true,
        departureAirport: true,
        estimatedPrice: true,
        paymentMethod: true,
        driverProfile: { select: { id: true, userId: true } },
      },
    });

    if (pending.length === 0) return;

    this.logger.log(`[Scheduler] Auto-complétion de ${pending.length} booking(s) passenger_confirming`);

    for (const booking of pending) {
      try {
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'completed' },
        });

        // Find or create conversation
        let conversationId: string | undefined;
        if (booking.driverProfile?.userId) {
          const existing = await this.prisma.conversation.findFirst({
            where: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
            select: { id: true },
          });
          conversationId = existing?.id ?? (await this.prisma.conversation.create({
            data: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
            select: { id: true },
          })).id;
        }

        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking:completed', { id: booking.id, conversationId });
        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: booking.id, status: 'completed' });
        this.notifications.sendToUser(booking.passengerId, 'Course validée automatiquement ✅', 'Votre course a été validée. Merci d\'utiliser AeroGo 24 !').catch(() => {});

        // Wallet chauffeur
        if (booking.driverProfile?.userId && booking.paymentMethod !== 'cash') {
          const pointsEarned = Math.floor(Number(booking.estimatedPrice));
          let driverWallet = await this.prisma.wallet.findUnique({ where: { userId: booking.driverProfile.userId } });
          if (!driverWallet) {
            driverWallet = await this.prisma.wallet.create({ data: { userId: booking.driverProfile.userId, balance: 0 } });
          }
          await this.prisma.wallet.update({
            where: { id: driverWallet.id },
            data: { balance: { increment: pointsEarned } },
          });
          await this.prisma.transaction.create({
            data: {
              walletId: driverWallet.id,
              amount: booking.estimatedPrice,
              type: 'deposit',
              status: 'completed',
              reference: `EARN-${booking.id}`,
              metadata: { bookingId: booking.id, passengerId: booking.passengerId, points: pointsEarned },
            },
          });
        }

        // Cashback passager
        try {
          let cashbackCountryCode: string | null = null;
          if (booking.departureAirport && booking.departureAirport !== 'INTERNATIONAL') {
            const ap = await this.prisma.airport.findUnique({
              where: { iataCode: booking.departureAirport },
              select: { countryCode: true },
            });
            cashbackCountryCode = ap?.countryCode?.toUpperCase() ?? null;
          }
          const tariffs = await this.settingsService.getTariffsByCountry(cashbackCountryCode);
          const cashbackRate = (tariffs as any).cashbackRate ?? 0.05;
          const cashbackPtVal = (tariffs as any).pointValue ?? 1;
          const priceLocal = Number(booking.estimatedPrice) || 0;
          const cashbackPts = Math.floor((priceLocal * cashbackRate) / cashbackPtVal);
          if (cashbackPts > 0) {
            await this.points.addPoints(
              booking.passengerId,
              cashbackPts,
              `Cashback auto — course ${booking.departureAirport} → ${booking.destination}`,
              'cashback',
            );
          }
        } catch { /* ignore */ }

        this.logger.log(`[Scheduler] Booking ${booking.id} auto-complété après ${timeoutMin}min sans confirmation passager`);
      } catch (e) {
        this.logger.error(`[Scheduler] Auto-complete échoué pour ${booking.id}: ${e.message}`);
      }
    }
  }

  /**
   * PAR·049 — Toutes les heures : retry les bonus parrainage dont le crédit a échoué après
   * la création du marqueur d'idempotence. Détecte via les clés Redis `referral:pending:*`.
   */
  @Cron('0 * * * *')
  async retryPendingReferrals() {
    const keys = await this.redis.scan('referral:pending:*').catch(() => [] as string[]);
    if (keys.length === 0) return;

    this.logger.log(`[PAR·049] ${keys.length} bonus parrainage en attente de retry`);

    for (const key of keys) {
      try {
        const raw = await this.redis.get(key);
        if (!raw) continue;
        const { referrerId, bonus, bookingId } = JSON.parse(raw) as { referrerId: string; bonus: number; bookingId: string };
        const passengerId = key.replace('referral:pending:', '');
        const idempotencyRef = `REFERRAL-FIRST-RIDE-${passengerId}`;

        // Vérifier si le marqueur DB existe déjà (bonus déjà crédité)
        const marker = await this.prisma.transaction.findUnique({ where: { reference: idempotencyRef } });
        if (marker) {
          await this.redis.del(key);
          continue;
        }

        // Retry : recréer le marqueur + créditer les points
        const referrerWallet = await this.prisma.wallet.findUnique({ where: { userId: referrerId } });
        if (referrerWallet) {
          await this.prisma.transaction.create({
            data: { walletId: referrerWallet.id, amount: bonus, type: 'deposit', status: 'completed', reference: idempotencyRef },
          });
        }
        await this.points.addPoints(referrerId, bonus, `Bonus parrainage — 1ère course de votre filleul (retry)`, 'referral');
        await this.redis.del(key);
        this.logger.log(`[PAR·049] Retry OK — +${bonus} pts → parrain ${referrerId} (filleul ${passengerId})`);
      } catch (e: any) {
        if (e?.code === 'P2002') {
          await this.redis.del(key).catch(() => {});
        } else {
          this.logger.error(`[PAR·049] Retry échoué pour ${key}: ${e.message}`);
        }
      }
    }
  }

  /**
   * WAL·076-warn — 15 du mois à 9h : avertir les utilisateurs dont les points vont expirer
   * au prochain cycle (inactifs depuis >11 mois). Délai configurable via points_expiry_warning_days.
   */
  @Cron('0 9 15 * *')
  async warnExpiringPoints() {
    const warningDaysRaw = await this.settingsService.get('points_expiry_warning_days', '30');
    const warningDays = parseInt(warningDaysRaw, 10) || 30;

    // Utilisateurs inactifs depuis (12 mois - warningDays) — seront expirés dans warningDays jours
    const inactiveSince = new Date(Date.now() - (365 - warningDays) * 24 * 60 * 60 * 1000);
    const stillActive  = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const recentUsers = await this.prisma.pointsTransaction.findMany({
      where: { createdAt: { gte: inactiveSince } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const recentIds = new Set(recentUsers.map((u) => u.userId));

    const oldEnoughUsers = await this.prisma.pointsTransaction.findMany({
      where: { createdAt: { lt: inactiveSince, gte: stillActive } },
      select: { userId: true },
      distinct: ['userId'],
    });
    // Utilisateurs sans activité depuis (12-warningDays) mois mais pas encore à 12 mois
    const warnIds = oldEnoughUsers.map((u) => u.userId).filter((id) => !recentIds.has(id));

    if (warnIds.length === 0) return;

    const balances = await this.prisma.pointsTransaction.groupBy({
      by: ['userId'],
      where: { userId: { in: warnIds } },
      _sum: { points: true },
    });

    const toWarn = balances.filter((b) => (b._sum.points ?? 0) > 0);
    this.logger.log(`[WAL·076-warn] ${toWarn.length} utilisateur(s) à avertir (expiration dans ~${warningDays}j)`);

    for (const entry of toWarn) {
      const pts = entry._sum.points ?? 0;
      try {
        // Clé Redis pour éviter de notifier 2× par cycle
        const warnKey = `points_warn:${entry.userId}:${new Date().getFullYear()}-${new Date().getMonth()}`;
        const alreadySent = await this.redis.get(warnKey).catch(() => null);
        if (alreadySent) continue;

        await this.notifications.sendToUser(
          entry.userId,
          '⚠️ Vos points expirent bientôt',
          `Vous avez ${pts.toLocaleString()} pts qui expireront dans ${warningDays} jours faute d'activité. Réservez une course pour les conserver.`,
        ).catch(() => {});

        await this.redis.set(warnKey, '1', 40 * 24 * 3600); // TTL 40 jours
        this.logger.log(`[WAL·076-warn] Notifié user ${entry.userId} (${pts} pts)`);
      } catch (e) {
        this.logger.error(`[WAL·076-warn] Erreur user ${entry.userId}: ${e.message}`);
      }
    }
  }

  /**
   * WAL·076 — 1er du mois à 3h : expirer les points des wallets inactifs depuis >12 mois.
   */
  @Cron('0 3 1 * *')
  async expireInactivePoints() {
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    // Utilisateurs avec activité récente (≤12 mois)
    const recentUsers = await this.prisma.pointsTransaction.findMany({
      where: { createdAt: { gte: cutoff } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const recentIds = new Set(recentUsers.map((u) => u.userId));

    // Tous les utilisateurs ayant eu des points
    const allUsers = await this.prisma.pointsTransaction.findMany({
      select: { userId: true },
      distinct: ['userId'],
    });
    const inactiveIds = allUsers.map((u) => u.userId).filter((id) => !recentIds.has(id));

    if (inactiveIds.length === 0) return;

    // Calculer le solde par utilisateur inactif
    const balances = await this.prisma.pointsTransaction.groupBy({
      by: ['userId'],
      where: { userId: { in: inactiveIds } },
      _sum: { points: true },
    });

    const toExpire = balances.filter((b) => (b._sum.points ?? 0) > 0);
    if (toExpire.length === 0) return;

    this.logger.warn(`[WAL·076] Expiration de ${toExpire.length} wallet(s) inactifs depuis >12 mois`);

    for (const entry of toExpire) {
      const balance = entry._sum.points ?? 0;
      try {
        await this.prisma.pointsTransaction.create({
          data: {
            userId: entry.userId,
            type: 'debit',
            points: -balance,
            label: `Expiration points — inactivité >12 mois`,
          },
        });
        await this.audit.log({
          action: 'points.expired',
          entity: 'user',
          entityId: entry.userId,
          meta: { expiredPoints: balance, reason: 'inactivity_12_months' },
        }).catch(() => {});
      } catch (e) {
        this.logger.error(`[WAL·076] Expiration échouée pour user ${entry.userId}: ${e.message}`);
      }
    }

    this.logger.log(`[WAL·076] ${toExpire.length} wallet(s) expirés (total: ${toExpire.reduce((s, b) => s + (b._sum.points ?? 0), 0)} pts)`);
  }

  /**
   * Toutes les 2 heures : retry des transactions Flutterwave bloquées en `pending`
   * depuis plus de 2h (webhook manqué côté Flutterwave).
   */
  @Cron('0 */2 * * *')
  async retryStuckFlutterwaveTransactions() {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const stuckTxs = await this.prisma.transaction.findMany({
      where: {
        status: 'pending',
        reference: { startsWith: 'WALLET-FLUTTERWAVE-' },
        createdAt: { lte: cutoff },
      },
      select: { id: true, reference: true, walletId: true, amount: true, metadata: true },
    });
    if (stuckTxs.length === 0) return;
    this.logger.log(`[FLW-RETRY] ${stuckTxs.length} transaction(s) Flutterwave en pending depuis >2h`);

    for (const tx of stuckTxs) {
      try {
        const meta = tx.metadata as Record<string, unknown> | null;
        const flwTxId = meta?.flwTxId as string | undefined;
        if (!flwTxId) {
          await this.prisma.transaction.update({ where: { id: tx.id }, data: { status: 'failed' } });
          this.logger.warn(`[FLW-RETRY] ${tx.reference} — pas de flwTxId, marqué failed`);
          continue;
        }
        const verified = await this.flutterwave.verify(flwTxId).catch(() => 'PENDING' as const);
        if (verified === 'ACCEPTED') {
          const { count } = await this.prisma.transaction.updateMany({
            where: { id: tx.id, status: 'pending' },
            data: { status: 'completed' },
          });
          if (count > 0) {
            const tariffs = await this.settingsService.getTariffs();
            const pointsToCredit = (meta?.points as number | undefined) ?? Math.floor(tx.amount / (tariffs.pointRechargeRate ?? tariffs.fcfaPerPoint ?? 1));
            await this.prisma.wallet.update({
              where: { id: tx.walletId },
              data: { balance: { increment: pointsToCredit } },
            });
            this.logger.log(`[FLW-RETRY] Wallet ${tx.walletId} crédité ${pointsToCredit} pts (retry ${tx.reference})`);
          }
        } else if (verified === 'REFUSED') {
          await this.prisma.transaction.update({ where: { id: tx.id }, data: { status: 'failed' } });
          this.logger.warn(`[FLW-RETRY] ${tx.reference} marqué failed (statut Flutterwave: ${verified})`);
        }
        // Si PENDING → on réessaiera au prochain cycle
      } catch (err: any) {
        this.logger.error(`[FLW-RETRY] Erreur pour ${tx.reference}: ${err?.message}`);
      }
    }
  }

  /**
   * Toutes les 5 minutes : dispatcher les réservations programmées dont la date
   * d'exécution est dans moins de 60 minutes (dispatch_scheduled_advance_min configurable).
   */
  @Cron('*/5 * * * *')
  async dispatchScheduledBookings() {
    const advanceRaw = await this.settingsService.get('dispatch_scheduled_advance_min', '60');
    const advanceMin = parseInt(advanceRaw, 10) || 60;
    const dispatchBefore = new Date(Date.now() + advanceMin * 60 * 1000);

    const due = await this.prisma.booking.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: dispatchBefore },
      },
      select: {
        id: true,
        passengerId: true,
        vehicleType: true,
        destination: true,
        type: true,
        pickupLat: true,
        pickupLng: true,
        scheduledAt: true,
      },
    });

    if (due.length === 0) return;
    this.logger.log(`[Scheduled] ${due.length} réservation(s) programmée(s) à dispatcher`);

    for (const booking of due) {
      try {
        // Idempotence : ne dispatcher qu'une fois
        const locked = await this.redis.setNx(`scheduled:dispatch:${booking.id}`, 'locked', 600);
        if (!locked) continue;

        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'pending' },
        });

        const eligibleDrivers = await this.dispatch.findEligibleDrivers(
          booking as any,
          false,
          booking.pickupLat && booking.pickupLng
            ? { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) }
            : undefined,
        );

        const scheduledStr = booking.scheduledAt
          ? new Date(booking.scheduledAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
          : '';

        for (const driver of eligibleDrivers) {
          this.notifications.sendToUser(
            driver.userId,
            'Réservation programmée disponible 🕐',
            `Course programmée le ${scheduledStr} vers ${booking.destination}`,
            { bookingId: booking.id, type: 'scheduled_booking' },
          ).catch(() => {});

          this.ridesGateway.notifyNewBooking(driver.id, {
            id: booking.id,
            passengerId: booking.passengerId,
            destination: booking.destination,
            vehicleType: booking.vehicleType,
            type: booking.type,
            isScheduled: true,
            scheduledAt: booking.scheduledAt?.toISOString(),
          } as any);
        }

        this.notifications.sendToUser(
          booking.passengerId,
          'Chauffeur recherché ✅',
          `Nous recherchons un chauffeur pour votre course programmée le ${scheduledStr}.`,
        ).catch(() => {});

        this.logger.log(`[Scheduled] Booking ${booking.id} dispatché (${eligibleDrivers.length} drivers notifiés)`);
      } catch (e: any) {
        this.logger.error(`[Scheduled] Dispatch échoué pour ${booking.id}: ${e.message}`);
      }
    }
  }

  // ── C.1 — Retrait automatique chauffeurs (48h post-completion) ───────────────

  @Cron('0 * * * *') // toutes les heures
  async autoWithdrawDrivers() {
    const enabled = await this.settingsService.get('auto_withdrawal_enabled', 'false');
    if (enabled !== 'true') return;

    const minRaw = await this.settingsService.get('min_withdrawal_amount', '5000');
    const minAmount = parseFloat(minRaw) || 5000;

    // Chauffeurs bloqués manuellement par un admin
    const blockedRaw = await this.settingsService.get('auto_withdrawal_blocked_drivers', '[]');
    let blockedIds: string[] = [];
    try { blockedIds = JSON.parse(blockedRaw); } catch { blockedIds = []; }

    // Drivers éligibles : portefeuille >= minAmount, compte vérifié, non bloqués
    const eligible = await this.prisma.driverProfile.findMany({
      where: {
        payoutVerified: true,
        payoutPhone:    { not: null },
        payoutMethod:   { not: null },
        id:             { notIn: blockedIds },
        earningsWallet: { balance: { gte: minAmount } },
      },
      select: {
        id:     true,
        userId: true,
        earningsWallet: { select: { balance: true } },
      },
    });

    if (eligible.length === 0) return;
    this.logger.log(`[AutoWithdraw] ${eligible.length} chauffeur(s) éligible(s)`);

    for (const driver of eligible) {
      const lockKey = `auto_withdraw:lock:${driver.id}`;
      // Idempotence : 48h de délai entre deux retraits automatiques
      const locked = await this.redis.setNx(lockKey, '1', 48 * 60 * 60);
      if (!locked) continue;

      const balance = driver.earningsWallet?.balance ?? 0;
      try {
        await this.payout.disburse({ driverProfileId: driver.id, amount: balance });
        this.logger.log(`[AutoWithdraw] Retrait initié driver=${driver.id} amount=${balance} XAF`);

        // C.3 — Notification push au chauffeur
        this.notifications.sendToUser(
          driver.userId,
          'Virement en cours',
          `Un virement de ${balance.toLocaleString('fr-FR')} XAF vient d'être initié vers votre compte Mobile Money.`,
          { type: 'auto_withdrawal', amount: String(balance) },
        ).catch(() => {});
      } catch (err: any) {
        // Retrait échoué → libérer le lock pour réessayer à la prochaine heure
        await this.redis.del(lockKey);
        this.logger.warn(`[AutoWithdraw] Échec driver=${driver.id}: ${err.message}`);
      }
    }
  }
}
