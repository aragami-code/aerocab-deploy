import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RidesGateway } from '../bookings/rides.gateway';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private prisma: PrismaService,
    private ridesGateway: RidesGateway,
  ) {}

  async register(userId: string, dto: RegisterDriverDto) {
    const existing = await this.prisma.driverProfile.findUnique({ where: { userId } });

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

    // Upsert: update if exists (keeps existing status/rating), create if not
    const profile = existing
      ? await this.prisma.driverProfile.update({
          where: { userId },
          data: vehicleData,
          include: { user: { select: { id: true, phone: true, name: true, role: true } }, documents: true },
        })
      : await this.prisma.driverProfile.create({
          data: { userId, ...vehicleData },
          include: { user: { select: { id: true, phone: true, name: true, role: true } }, documents: true },
        });

    this.logger.log(`Driver registered: ${userId}`);
    return profile;
  }

  async getMyProfile(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
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
    });

    if (!profile) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    return profile;
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

  async submitForReview(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { documents: true },
    });

    if (!profile) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    // Check required documents
    const requiredTypes = [
      'cni_front',
      'cni_back',
      'license',
      'registration',
      'vehicle_photo',
    ];
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
      },
    });

    // Sauvegarde la position si une course est en cours (pour le replay)
    const activeBooking = await this.prisma.booking.findFirst({
      where: { driverProfileId: profile.id, status: 'in_progress' },
      select: { id: true, driverProfileId: true },
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

      // Émettre la position en temps réel au passager
      const booking = await this.prisma.booking.findUnique({
        where: { id: activeBooking.id },
        select: { passengerId: true },
      });
      if (booking?.passengerId) {
        this.ridesGateway.server
          .to(`passenger:${booking.passengerId}`)
          .emit('driver:position', {
            bookingId: activeBooking.id,
            latitude: dto.latitude,
            longitude: dto.longitude,
            timestamp: new Date().toISOString(),
          });
      }
    }

    // Émettre aussi pour les courses confirmées (chauffeur en route)
    const confirmedBooking = await this.prisma.booking.findFirst({
      where: { driverProfileId: profile.id, status: 'confirmed' },
      select: { id: true, passengerId: true },
    });
    if (confirmedBooking?.passengerId) {
      this.ridesGateway.server
        .to(`passenger:${confirmedBooking.passengerId}`)
        .emit('driver:position', {
          bookingId: confirmedBooking.id,
          latitude: dto.latitude,
          longitude: dto.longitude,
          timestamp: new Date().toISOString(),
        });
    }

    // B2 — Émettre aussi pour les courses où le chauffeur est arrivé (en attente du passager)
    const arrivedBooking = await this.prisma.booking.findFirst({
      where: { driverProfileId: profile.id, status: 'arrived_at_airport' },
      select: { id: true, passengerId: true },
    });
    if (arrivedBooking?.passengerId) {
      this.ridesGateway.server
        .to(`passenger:${arrivedBooking.passengerId}`)
        .emit('driver:position', {
          bookingId: arrivedBooking.id,
          latitude: dto.latitude,
          longitude: dto.longitude,
          timestamp: new Date().toISOString(),
        });
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
    // Simple distance filter using bounding box for performance
    // 1 degree latitude ~ 111 km
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((latitude * Math.PI) / 180));

    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        status: 'approved',
        isAvailable: true,
        latitude: {
          gte: latitude - latDelta,
          lte: latitude + latDelta,
        },
        longitude: {
          gte: longitude - lngDelta,
          lte: longitude + lngDelta,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
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
    if (!mobileNumber?.trim()) {
      throw new BadRequestException('Numéro Mobile Money requis.');
    }

    // Vérifier que le wallet existe et a un solde suffisant
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    const balance = Number(wallet?.balance ?? 0);
    if (balance < amount) {
      throw new BadRequestException(
        `Solde insuffisant : ${balance} XAF disponibles, ${amount} XAF demandés.`,
      );
    }

    // Vérifier pas de retrait pending en cours (1 à la fois)
    const pending = await this.prisma.withdrawalRequest.findFirst({
      where: { userId, status: 'pending' },
    });
    if (pending) {
      throw new BadRequestException('Un retrait est déjà en cours de traitement. Attendez sa validation avant d\'en soumettre un nouveau.');
    }

    return this.prisma.withdrawalRequest.create({
      data: {
        userId,
        amount,
        method: method as any,
        mobileNumber: mobileNumber.trim(),
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
    const validTypes = ['cni_front', 'cni_back', 'license', 'registration', 'vehicle_photo'];
    if (!validTypes.includes(type)) throw new BadRequestException('Type de document invalide');

    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');
    if (!file) throw new BadRequestException('Fichier manquant');

    const apiUrl = process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
    const fileUrl = `${apiUrl}/uploads/${file.filename}`;

    const document = await this.prisma.driverDocument.upsert({
      where: { driverProfileId_type: { driverProfileId: profile.id, type: type as any } },
      update: { fileUrl, status: 'pending', rejectionReason: null, verifiedAt: null },
      create: { driverProfileId: profile.id, type: type as any, fileUrl },
    });

    this.logger.log(`Document uploaded (multipart): ${type} for driver ${profile.id}`);
    return document;
  }
}
