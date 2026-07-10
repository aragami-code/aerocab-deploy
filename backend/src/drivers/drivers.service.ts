import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RidesGateway } from '../bookings/rides.gateway';
import { SettingsService } from '../settings/settings.service';
import { BookingsService } from '../bookings/bookings.service';
import { NotchPayService } from '../payments/notchpay.service';
import { AdminNotificationService } from '../admin/admin-notification.service';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { extractCountryFromPhone } from '../common/phone-country';
import { canChangeCountry } from './wallet-guard';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private prisma: PrismaService,
    private ridesGateway: RidesGateway,
    private settings: SettingsService,
    @Inject(forwardRef(() => BookingsService))
    private bookingsService: BookingsService,
    private notchpay: NotchPayService,
    private adminNotifs: AdminNotificationService,
  ) {}

  async register(userId: string, dto: RegisterDriverDto) {
    const [existing, user] = await Promise.all([
      this.prisma.driverProfile.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
    ]);

    // Update user role (and name if provided)
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        role: 'driver',
        ...(dto.name ? { name: dto.name } : {}),
      },
    });

    const vehicleData = {
      vehicleBrand: dto.vehicleBrand,
      vehicleModel: dto.vehicleModel,
      vehicleColor: dto.vehicleColor,
      vehiclePlate: dto.vehiclePlate,
      ...(dto.vehicleYear !== undefined && { vehicleYear: dto.vehicleYear }),
      ...(dto.vehicleCategory !== undefined && { vehicleCategory: dto.vehicleCategory }),
      languages: dto.languages,
    };

    // Auto-populate countryCode from phone on first creation only
    const derivedCountryCode = user?.phone ? extractCountryFromPhone(user.phone) : null;

    // Upsert: update if exists (keeps existing status/rating/countryCode), create if not
    const profile = existing
      ? await this.prisma.driverProfile.update({
          where: { userId },
          data: vehicleData,
          include: { user: { select: { id: true, phone: true, name: true, role: true } }, documents: true },
        })
      : await this.prisma.driverProfile.create({
          data: { userId, ...vehicleData, countryCode: derivedCountryCode },
          include: { user: { select: { id: true, phone: true, name: true, role: true } }, documents: true },
        });

    this.logger.log(`Driver registered: ${userId}${derivedCountryCode && !existing ? ` countryCode=${derivedCountryCode}` : ''}`);

    void this.adminNotifs.notify(
      'driver.register',
      'Nouveau chauffeur inscrit',
      `${profile.user?.name ?? userId} — ${dto.vehicleBrand} ${dto.vehicleModel}`,
      { driverProfileId: profile.id, userId, vehicle: `${dto.vehicleBrand} ${dto.vehicleModel}` },
    );

    return profile;
  }

  async getMyProfile(userId: string) {
    const [profile, wallet] = await Promise.all([
      this.prisma.driverProfile.findUnique({
        where: { userId },
        include: {
          user: {
            select: {
              id: true,
              phone: true,
              name: true,
              email: true,
              role: true,
              avatarUrl: true,
            },
          },
          documents: {
            select: {
              id: true,
              type: true,
              fileUrl: true,
              status: true,
              rejectionReason: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
    ]);

    if (!profile) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    return { ...profile, walletBalance: Number(wallet?.balance ?? 0) };
  }

  async updateProfile(userId: string, dto: UpdateDriverDto) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    const updated = await this.prisma.driverProfile.update({
      where: { userId },
      data: {
        ...(dto.vehicleBrand !== undefined && {
          vehicleBrand: dto.vehicleBrand,
        }),
        ...(dto.vehicleModel !== undefined && {
          vehicleModel: dto.vehicleModel,
        }),
        ...(dto.vehicleColor !== undefined && {
          vehicleColor: dto.vehicleColor,
        }),
        ...(dto.vehiclePlate !== undefined && {
          vehiclePlate: dto.vehiclePlate,
        }),
        ...(dto.vehicleYear !== undefined && { vehicleYear: dto.vehicleYear }),
        ...(dto.languages !== undefined && { languages: dto.languages }),
        ...(dto.vehicleCategory !== undefined && { vehicleCategory: dto.vehicleCategory }),
      },
      include: {
        user: {
          select: { id: true, phone: true, name: true, avatarUrl: true },
        },
      },
    });

    return updated;
  }

  async uploadDocument(userId: string, dto: UploadDocumentDto) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    // Upsert document (replace if same type exists)
    const document = await this.prisma.driverDocument.upsert({
      where: {
        driverProfileId_type: {
          driverProfileId: profile.id,
          type: dto.type as any,
        },
      },
      update: {
        fileUrl: dto.fileUrl,
        status: 'pending',
        rejectionReason: null,
        verifiedAt: null,
      },
      create: {
        driverProfileId: profile.id,
        type: dto.type as any,
        fileUrl: dto.fileUrl,
      },
    });

    this.logger.log(
      `Document uploaded: ${dto.type} for driver ${profile.id}`,
    );

    void this.adminNotifs.notify(
      'driver.document_upload',
      'Document chauffeur uploadé',
      `${dto.type} — chauffeur ${profile.id}`,
      { driverProfileId: profile.id, documentType: dto.type },
    );

    return document;
  }

  async getDocuments(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        documents: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    return profile.documents;
  }

  // ── Country Change Request ────────────────────────────────────────────────

  async requestCountryChange(userId: string, requestedCountry: string, reason: string) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true, countryCode: true } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const pending = await (this.prisma as any).countryChangeRequest.findFirst({
      where: { driverProfileId: profile.id, status: 'pending' },
    });
    if (pending) throw new BadRequestException('Une demande de changement de pays est déjà en attente de traitement.');

    const currentCountry = profile.countryCode ?? 'CM';
    if (requestedCountry.toUpperCase() === currentCountry.toUpperCase()) {
      throw new BadRequestException('Le pays demandé est identique au pays actuel.');
    }

    const request = await (this.prisma as any).countryChangeRequest.create({
      data: {
        driverProfileId: profile.id,
        currentCountry,
        requestedCountry: requestedCountry.toUpperCase(),
        reason,
        status: 'pending',
      },
    });

    this.logger.log(`Country change request: driver ${userId} ${currentCountry} → ${requestedCountry}`);

    void this.adminNotifs.notify(
      'driver.country_change',
      'Demande changement de pays',
      `Chauffeur ${userId} : ${currentCountry} → ${requestedCountry.toUpperCase()}`,
      { driverProfileId: profile.id, currentCountry, requestedCountry: requestedCountry.toUpperCase() },
    );

    return request;
  }

  async getCountryChangeRequest(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const request = await (this.prisma as any).countryChangeRequest.findFirst({
      where: { driverProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
    return request ?? null;
  }

  async adminListCountryChangeRequests(status?: string) {
    const where = status ? { status } : {};
    return (this.prisma as any).countryChangeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        driverProfile: {
          select: {
            id: true,
            countryCode: true,
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });
  }

  async adminReviewCountryChangeRequest(requestId: string, adminId: string, status: 'approved' | 'rejected', adminNote?: string) {
    const req = await (this.prisma as any).countryChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Demande introuvable');
    if (req.status !== 'pending') throw new BadRequestException('Cette demande a déjà été traitée.');

    // Garde wallet vide : à vérifier AVANT de marquer la demande approuvée,
    // sinon la demande resterait "approved" sans application du changement.
    if (status === 'approved') {
      const wallet = await this.prisma.driverEarningsWallet.findUnique({
        where: { driverProfileId: req.driverProfileId },
        select: { balance: true },
      });
      const guard = canChangeCountry(wallet?.balance ?? 0);
      if (!guard.ok) throw new BadRequestException(guard.reason);
    }

    await (this.prisma as any).countryChangeRequest.update({
      where: { id: requestId },
      data: { status, adminNote: adminNote ?? null, reviewedBy: adminId, reviewedAt: new Date() },
    });

    if (status === 'approved') {
      const newCountry = req.requestedCountry.toUpperCase();
      const newCurrency = (await this.prisma.country.findUnique({
        where: { code: newCountry }, select: { currency: true },
      }))?.currency ?? null;
      await this.prisma.driverProfile.update({
        where: { id: req.driverProfileId },
        data: { countryCode: newCountry },
      });
      if (newCurrency) {
        await this.prisma.driverEarningsWallet.updateMany({
          where: { driverProfileId: req.driverProfileId },
          data: { currency: newCurrency },
        });
      }
      this.logger.log(`Country change approved: driverProfile ${req.driverProfileId} → ${newCountry} (currency ${newCurrency})`);
    }

    return { success: true, status };
  }

  async submitForReview(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { documents: true },
    });

    if (!profile) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    // Required types from admin config (falls back to hardcoded defaults)
    let requiredTypes = ['cni_front', 'cni_back', 'license', 'registration', 'vehicle_photo'];
    try {
      const raw = await this.settings.getForCountry('driver_document_config', profile.countryCode ?? null, '');
      if (raw) {
        const config: { type: string; required: boolean; enabled: boolean }[] = JSON.parse(raw);
        const fromConfig = config.filter(d => d.enabled && d.required).map(d => d.type);
        if (fromConfig.length > 0) requiredTypes = fromConfig;
      }
    } catch { /* keep defaults */ }
    const uploadedTypes = profile.documents.map((d) => d.type);
    const missing = requiredTypes.filter((t) => !uploadedTypes.includes(t as any));

    if (missing.length > 0) {
      throw new BadRequestException(
        `Documents manquants: ${missing.join(', ')}`,
      );
    }

    // Set status to pending if not already
    if (profile.status !== 'pending') {
      await this.prisma.driverProfile.update({
        where: { userId },
        data: { status: 'pending' },
      });
    }

    void this.adminNotifs.notify(
      'driver.submit_review',
      'Dossier chauffeur à vérifier',
      `Chauffeur ${userId} a soumis son dossier pour vérification`,
      { driverProfileId: profile.id, userId },
    );

    return { message: 'Dossier soumis pour verification', status: 'pending' };
  }

  async updateLocation(userId: string, dto: UpdateLocationDto) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    if (profile.status !== 'approved') {
      throw new ForbiddenException(
        'Seuls les chauffeurs approuves peuvent mettre a jour leur position',
      );
    }

    await this.prisma.driverProfile.update({
      where: { userId },
      data: {
        latitude: dto.latitude,
        longitude: dto.longitude,
        locationUpdatedAt: new Date(),
        isOnline: true,
      },
    });

    // Sauvegarde la position + émission WebSocket pour tous les statuts actifs
    const activeBooking = await this.prisma.booking.findFirst({
      where: {
        driverProfileId: profile.id,
        status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] },
      },
      select: { id: true, driverProfileId: true, passengerId: true, status: true },
    });

    if (activeBooking) {
      this.prisma.driverPosition.create({
        data: {
          bookingId: activeBooking.id,
          driverProfileId: profile.id,
          latitude: dto.latitude,
          longitude: dto.longitude,
        },
      }).catch(() => {});

      if (activeBooking.passengerId) {
        this.ridesGateway.server
          .to(`passenger:${activeBooking.passengerId}`)
          .emit('driver:position', {
            bookingId: activeBooking.id,
            latitude: dto.latitude,
            longitude: dto.longitude,
            timestamp: new Date().toISOString(),
          });
      }
    }

    return { message: 'Position mise a jour' };
  }

  async toggleAvailability(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    if (profile.status !== 'approved') {
      throw new ForbiddenException(
        'Seuls les chauffeurs approuves peuvent changer leur disponibilite',
      );
    }

    const regFeeEnabled = await this.settings.get('feature_registration_fee_enabled', 'false');
    if (regFeeEnabled === 'true' && !profile.registrationFeePaid) {
      throw new ForbiddenException('Frais d\'inscription requis avant de devenir disponible');
    }

    const updated = await this.prisma.driverProfile.update({
      where: { userId },
      data: { isAvailable: !profile.isAvailable },
    });

    return {
      isAvailable: updated.isAvailable,
      message: updated.isAvailable ? 'Vous etes maintenant disponible' : 'Vous etes maintenant indisponible',
    };
  }

  async getNearbyDrivers(latitude: number, longitude: number, radiusKm = 15) {
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((latitude * Math.PI) / 180));

    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        status: 'approved',
        isAvailable: true,
        OR: [
          // Chauffeurs avec GPS dans le rayon
          {
            latitude:  { gte: latitude - latDelta,  lte: latitude + latDelta },
            longitude: { gte: longitude - lngDelta, lte: longitude + lngDelta },
          },
          // Chauffeurs en ligne mais GPS pas encore reçu
          { isOnline: true, latitude: null },
        ],
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { ratingAvg: 'desc' },
    });

    return drivers;
  }

  async getDriverById(driverId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            phone: true,
          },
        },
      },
    });

    if (!profile || profile.status !== 'approved') {
      throw new NotFoundException('Chauffeur introuvable');
    }

    return profile;
  }

  async setAvailability(userId: string, isAvailable: boolean) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');
    if (profile.status !== 'approved') {
      throw new ForbiddenException('Seuls les chauffeurs approuves peuvent changer leur disponibilite');
    }
    const regFeeEnabled = await this.settings.get('feature_registration_fee_enabled', 'false');
    if (regFeeEnabled === 'true' && isAvailable && !profile.registrationFeePaid) {
      throw new ForbiddenException('Frais d\'inscription requis avant de devenir disponible');
    }

    const updated = await this.prisma.driverProfile.update({
      where: { userId },
      data: { isAvailable },
    });

    return {
      isAvailable: updated.isAvailable,
      message: updated.isAvailable ? 'Vous etes maintenant disponible' : 'Vous etes maintenant indisponible',
    };
  }

  async getEarnings(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayBookings, weekBookings, monthBookings, wallet] = await Promise.all([
      this.prisma.booking.findMany({
        where: { driverProfileId: profile.id, status: 'completed', updatedAt: { gte: startOfDay } },
        select: { estimatedPrice: true },
      }),
      this.prisma.booking.findMany({
        where: { driverProfileId: profile.id, status: 'completed', updatedAt: { gte: startOfWeek } },
        select: { estimatedPrice: true },
      }),
      this.prisma.booking.findMany({
        where: { driverProfileId: profile.id, status: 'completed', updatedAt: { gte: startOfMonth } },
        select: { estimatedPrice: true },
      }),
      this.prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
    ]);

    const sum = (list: { estimatedPrice: any }[]) =>
      list.reduce((acc, b) => acc + Number(b.estimatedPrice), 0);

    return {
      today: sum(todayBookings),
      thisWeek: sum(weekBookings),
      thisMonth: sum(monthBookings),
      totalRides: profile.totalRides,
      walletBalance: Number(wallet?.balance ?? 0),
      currency: 'XAF',
    };
  }

  // ── Retraits ─────────────────────────────────────────────────────────────────

  async requestWithdrawal(userId: string, amount: number, method: string, mobileNumber: string) {
    const validMethods = ['orange_money', 'mtn_momo', 'bank_transfer'];
    if (!validMethods.includes(method)) {
      throw new BadRequestException('Méthode de retrait invalide. Utilisez : orange_money, mtn_momo ou bank_transfer.');
    }
    if (!amount || amount <= 0) {
      throw new BadRequestException('Le montant doit être supérieur à 0.');
    }
    const cleanedNumber = mobileNumber?.trim() ?? '';
    if (!cleanedNumber) {
      throw new BadRequestException('Numéro Mobile Money requis.');
    }
    const MOBILE_RE = /^\+?[0-9]{8,15}$/;
    if (!MOBILE_RE.test(cleanedNumber.replace(/\s/g, ''))) {
      throw new BadRequestException(
        'Numéro Mobile Money invalide. Utilisez le format international (ex: +237 6XXXXXXXX).',
      );
    }

    // ── Chargement des paramètres de sécurité (parallèle) ────────────────────
    const [
      wallet,
      user,
      maxDailyRaw,
      minAmountRaw,
      maxAmountRaw,
      carenceRaw,
    ] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
      this.settings.get('withdrawal_max_daily_amount',  '200000'),
      this.settings.get('withdrawal_min_amount',        '1000'),
      this.settings.get('withdrawal_max_amount',        '100000'),
      this.settings.get('withdrawal_carence_hours',     '24'),
    ]);

    const maxDaily  = parseInt(maxDailyRaw,  10) || 200000;
    const minAmount = parseInt(minAmountRaw, 10) || 1000;
    const maxAmount = parseInt(maxAmountRaw, 10) || 100000;
    const carenceH  = parseInt(carenceRaw,   10) || 24;

    // ── Montant minimum ───────────────────────────────────────────────────────
    if (amount < minAmount) {
      throw new BadRequestException(
        `Montant minimum de retrait : ${minAmount.toLocaleString()} XAF`,
      );
    }

    // ── Montant maximum par demande ───────────────────────────────────────────
    if (amount > maxAmount) {
      throw new BadRequestException(
        `Montant maximum de retrait : ${maxAmount.toLocaleString()} XAF par demande`,
      );
    }

    // ── Solde suffisant ───────────────────────────────────────────────────────
    const balance = Number(wallet?.balance ?? 0);
    if (balance < amount) {
      throw new BadRequestException(
        `Solde insuffisant : ${balance.toLocaleString()} XAF disponibles, ${amount.toLocaleString()} XAF demandés.`,
      );
    }

    // ── Pas de retrait pending en cours (1 à la fois) ────────────────────────
    const pending = await this.prisma.withdrawalRequest.findFirst({
      where: { userId, status: 'pending' },
    });
    if (pending) {
      throw new BadRequestException(
        'Un retrait est déjà en cours de traitement. Attendez sa validation avant d\'en soumettre un nouveau.',
      );
    }

    // ── Limite journalière ────────────────────────────────────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayWithdrawals = await this.prisma.withdrawalRequest.aggregate({
      where: {
        userId,
        status: { in: ['pending', 'approved', 'paid'] },
        createdAt: { gte: todayStart },
      },
      _sum: { amount: true },
    });
    const todayTotal = Number(todayWithdrawals._sum.amount ?? 0);
    if (todayTotal + amount > maxDaily) {
      throw new BadRequestException(
        `Plafond journalier de retrait atteint : ${maxDaily.toLocaleString()} XAF/jour (déjà demandé : ${todayTotal.toLocaleString()} XAF)`,
      );
    }

    // ── Carence recharge → retrait ────────────────────────────────────────────
    if (carenceH > 0) {
      const walletId = wallet?.id;
      if (walletId) {
        const lastDeposit = await this.prisma.transaction.findFirst({
          where: { walletId, type: 'deposit', status: 'completed' },
          orderBy: { createdAt: 'desc' },
        });
        if (lastDeposit) {
          const hoursSinceDeposit = (Date.now() - new Date(lastDeposit.createdAt).getTime()) / 3_600_000;
          if (hoursSinceDeposit < carenceH) {
            const remaining = Math.ceil(carenceH - hoursSinceDeposit);
            throw new BadRequestException(
              `Délai de sécurité non écoulé après votre dernière recharge. Réessayez dans ${remaining}h (délai configuré : ${carenceH}h).`,
            );
          }
        }
      }
    }

    // ── Vérification numéro : doit correspondre au profil ou format validé ────
    if (user?.phone) {
      const normalize = (n: string) => n.replace(/[\s\-().]/g, '').replace(/^\+/, '');
      const profileNorm  = normalize(user.phone);
      const requestNorm  = normalize(cleanedNumber);
      // Autoriser si le numéro soumis se termine par les 8 derniers chiffres du profil
      const profileTail  = profileNorm.slice(-8);
      const requestTail  = requestNorm.slice(-8);
      if (profileTail !== requestTail) {
        throw new BadRequestException(
          `Le numéro de retrait ne correspond pas au numéro enregistré sur votre profil. Mettez à jour votre profil ou utilisez votre numéro habituel.`,
        );
      }
    }

    return this.prisma.withdrawalRequest.create({
      data: {
        userId,
        amount,
        method: method as any,
        mobileNumber: cleanedNumber,
        status: 'pending',
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        method: true,
        mobileNumber: true,
        status: true,
        createdAt: true,
      },
    }).then((w) => {
      void this.adminNotifs.notify(
        'driver.withdrawal_request',
        'Demande de retrait',
        `${amount.toLocaleString()} XAF — ${method} — ${cleanedNumber}`,
        { withdrawalId: w.id, userId, amount, method },
      );
      return w;
    });
  }

  async getWithdrawals(userId: string, page = 1, limit = 20) {
    const skip = Math.max(0, (page - 1) * limit);
    const [data, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          mobileNumber: true,
          status: true,
          adminNote: true,
          processedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.withdrawalRequest.count({ where: { userId } }),
    ]);
    return { data, total, page, limit };
  }

  async uploadDocumentFile(userId: string, type: string, file: any) {
    const validTypes = [
      'cni_front', 'cni_back', 'license', 'registration', 'vehicle_photo',
      'selfie', 'criminal_record', 'passport', 'portrait', 'insurance',
      'technical_control', 'vtc_license', 'proof_of_address',
      'medical_certificate', 'vaccination_card', 'border_pass',
    ];
    if (!validTypes.includes(type)) throw new BadRequestException('Type de document invalide');

    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');
    if (!file) throw new BadRequestException('Fichier manquant');

    const fileUrl = `/api/uploads/${file.filename}`;

    const document = await this.prisma.driverDocument.upsert({
      where: { driverProfileId_type: { driverProfileId: profile.id, type: type as any } },
      update: { fileUrl, status: 'pending', rejectionReason: null, verifiedAt: null },
      create: { driverProfileId: profile.id, type: type as any, fileUrl },
    });

    this.logger.log(`Document uploaded (multipart): ${type} for driver ${profile.id}`);

    void this.adminNotifs.notify(
      'driver.document_upload',
      'Document chauffeur uploadé',
      `${type} — chauffeur ${profile.id}`,
      { driverProfileId: profile.id, documentType: type },
    );

    return document;
  }

  // ── Frais d'inscription ────────────────────────────────────────────────────

  async getRegistrationFeeStatus(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where:  { userId },
      select: { id: true, registrationFeePaid: true, registrationFeeAmount: true },
    });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const featureEnabled = await this.settings.get('feature_registration_fee_enabled', 'false');
    if (featureEnabled !== 'true') {
      return { required: false, paid: true, paidAmount: null, minFee: 0, maxFee: 0, pendingPayment: null };
    }

    const minFee = parseFloat(await this.settings.get('registration_fee_min', '5000'));
    const maxFee = parseFloat(await this.settings.get('registration_fee_max', '10000'));

    const pending = await this.prisma.driverRegistrationPayment.findFirst({
      where:   { driverProfileId: profile.id, status: 'pending' },
      select:  { id: true, totalAmount: true, provider: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      required:   true,
      paid:       profile.registrationFeePaid,
      paidAmount: profile.registrationFeeAmount ?? null,
      minFee,
      maxFee,
      pendingPayment: pending ?? null,
    };
  }

  async initiateRegistrationFee(
    userId: string,
    provider: 'orange_money_cm' | 'mtn_cm' | 'cash',
  ): Promise<{ reference: string; paymentUrl?: string; status: string }> {
    const profile = await this.prisma.driverProfile.findUnique({
      where:  { userId },
      select: { id: true, registrationFeePaid: true },
    });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const featureEnabled = await this.settings.get('feature_registration_fee_enabled', 'false');
    if (featureEnabled !== 'true') {
      throw new BadRequestException('Frais d\'inscription désactivés');
    }

    if (profile.registrationFeePaid) {
      throw new BadRequestException('Frais d\'inscription déjà payés');
    }

    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { name: true, phone: true, email: true },
    });

    const totalAmount = parseFloat(await this.settings.get('registration_fee_min', '5000'));
    const depositPct  = parseFloat(await this.settings.get('registration_fee_deposit_pct', '50')) / 100;
    const depositAmount  = Math.round(totalAmount * depositPct);
    const revenueAmount  = totalAmount - depositAmount;
    const reference = `REGFEE-${profile.id.slice(0, 8)}-${Date.now()}`;

    // Cash : paiement hors ligne — admin confirmera via webhook
    if (provider === 'cash') {
      await this.prisma.driverRegistrationPayment.create({
        data: {
          driverProfileId: profile.id,
          totalAmount,
          revenueAmount,
          depositAmount,
          provider,
          providerRef: reference,
          status: 'pending',
        },
      });
      return { reference, status: 'pending_cash' };
    }

    // Mobile Money via NotchPay
    const { paymentUrl } = await this.notchpay.initiate({
      transactionId: reference,
      amount:        totalAmount,
      currency:      'XAF',
      description:   `Frais d'inscription AeroCab — chauffeur ${profile.id.slice(0, 8)}`,
      customerName:  user?.name  ?? '',
      customerPhone: user?.phone ?? '',
      customerEmail: user?.email ?? '',
    });

    await this.prisma.driverRegistrationPayment.create({
      data: {
        driverProfileId: profile.id,
        totalAmount,
        revenueAmount,
        depositAmount,
        provider,
        providerRef: reference,
        status: 'pending',
      },
    });

    return { reference, paymentUrl, status: 'pending' };
  }

  async getDailyGoalsProgress(userId: string) {
    const goalsRaw = await this.settings.get('daily_goals', JSON.stringify({ rides: 5, earnings: 25000, rating: 4.5 }));
    let goals: { rides: number; earnings: number; rating: number };
    try { goals = JSON.parse(goalsRaw); } catch { goals = { rides: 5, earnings: 25000, rating: 4.5 }; }

    const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true, ratingAvg: true } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [ridesCount, earningsAgg] = await Promise.all([
      this.prisma.booking.count({
        where: { driverProfileId: profile.id, status: 'completed', completedAt: { gte: today } },
      }),
      this.prisma.bookingPayout.aggregate({
        where: { driverProfileId: profile.id, createdAt: { gte: today } },
        _sum: { netAmount: true },
      }),
    ]);

    const todayEarnings = earningsAgg._sum.netAmount ?? 0;
    const currentRating = Number(profile.ratingAvg ?? 0);

    return {
      goals,
      progress:  { rides: ridesCount, earnings: Math.round(todayEarnings), rating: Math.round(currentRating * 10) / 10 },
      pct:       {
        rides:    Math.min(100, Math.round((ridesCount / Math.max(1, goals.rides)) * 100)),
        earnings: Math.min(100, Math.round((todayEarnings / Math.max(1, goals.earnings)) * 100)),
        rating:   currentRating >= goals.rating ? 100 : Math.min(100, Math.round((currentRating / Math.max(0.1, goals.rating)) * 100)),
      },
      achieved:  { rides: ridesCount >= goals.rides, earnings: todayEarnings >= goals.earnings, rating: currentRating >= goals.rating },
    };
  }

  async confirmRegistrationFee(providerRef: string): Promise<void> {
    const regPayment = await this.prisma.driverRegistrationPayment.findFirst({
      where: { providerRef },
    });
    if (!regPayment || regPayment.status === 'paid') return;

    await this.prisma.$transaction([
      this.prisma.driverRegistrationPayment.update({
        where: { id: regPayment.id },
        data:  { status: 'paid', paidAt: new Date() },
      }),
      this.prisma.driverProfile.update({
        where: { id: regPayment.driverProfileId },
        data:  {
          registrationFeePaid:   true,
          registrationFeeAmount: regPayment.totalAmount,
          registrationFeePaidAt: new Date(),
          cashDepositBalance:    { increment: regPayment.depositAmount },
        },
      }),
    ]);

    this.logger.log(`Frais inscription confirmés: driverId=${regPayment.driverProfileId} montant=${regPayment.totalAmount}`);
  }
}
