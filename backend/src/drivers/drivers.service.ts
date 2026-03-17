import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(private prisma: PrismaService) {}

  async register(userId: string, dto: RegisterDriverDto) {
    // Check if user already has a driver profile
    const existing = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new BadRequestException('Profil chauffeur deja cree');
    }

    // Update user role to driver and name
    await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'driver', name: dto.name },
    });

    // Create driver profile
    const profile = await this.prisma.driverProfile.create({
      data: {
        userId,
        vehicleBrand: dto.vehicleBrand,
        vehicleModel: dto.vehicleModel,
        vehicleColor: dto.vehicleColor,
        vehiclePlate: dto.vehiclePlate,
        vehicleYear: dto.vehicleYear,
        languages: dto.languages,
      },
      include: {
        user: {
          select: { id: true, phone: true, name: true, role: true },
        },
        documents: true,
      },
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
}
