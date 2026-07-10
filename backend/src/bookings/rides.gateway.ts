import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { TrustScoreService } from '../users/trust-score.service';
import { FavoritesService } from '../favorites/favorites.service';
import { SocketTenantScoped } from '../tenancy/socket-tenant-scoped.decorator';
import { ZERO_TENANT_ID } from '../tenancy/tenant.constants';

// CORS WebSocket configurable par env : si CORS_ORIGINS défini (liste séparée par virgules),
// on restreint aux origines ; sinon '*' (défaut — les clients mobiles natifs n'envoient pas
// d'Origin, ils ne sont donc pas impactés ; c'est surtout pour les clients navigateur).
const WS_CORS_ORIGIN: string | string[] = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : '*';

/**
 * Gateway principal (namespace /) pour les chauffeurs.
 * Le driver SDK se connecte sans namespace : io(SOCKET_URL, { auth: { token } })
 *
 * Rooms :
 *   driver:{driverProfileId}   — room personnelle du chauffeur
 *   passenger:{userId}          — room personnelle du passager (pour notifs de statut)
 */
@WebSocketGateway({
  cors: { origin: WS_CORS_ORIGIN },
})
export class RidesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RidesGateway.name);
  private userSockets = new Map<string, string[]>();

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private trustScore: TrustScoreService,
    private favorites: FavoritesService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.query?.token;

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token as string);
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      client.data.tenantId = payload.tenantId ?? ZERO_TENANT_ID;

      if (payload.role === 'passenger') {
        client.join(`passenger:${payload.sub}`);
      }

      if (payload.role === 'admin') {
        client.join('admin:dashboard');
      }

      const sockets = this.userSockets.get(payload.sub) || [];
      sockets.push(client.id);
      this.userSockets.set(payload.sub, sockets);

      this.logger.log(
        `[Rides] Client connected: ${client.id} (user: ${payload.sub}, role: ${payload.role})`,
      );
    } catch {
      client.disconnect();
    }
  }

  @SocketTenantScoped()
  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      const sockets = this.userSockets.get(userId) || [];
      const filtered = sockets.filter((id) => id !== client.id);
      if (filtered.length > 0) {
        this.userSockets.set(userId, filtered);
      } else {
        this.userSockets.delete(userId);
        // S221 — Plus aucun socket actif → marquer le driver offline
        if (client.data.role === 'driver') {
          this.prisma.driverProfile.updateMany({
            where: { userId },
            data: { isOnline: false, lastActive: new Date() },
          }).catch(() => {});
        }
      }
    }
    this.logger.log(`[Rides] Client disconnected: ${client.id}`);
  }

  /**
   * Le chauffeur rejoint sa room personnelle après connexion.
   * emit('join:driver', { driverId: profile.id })
   */
  @SubscribeMessage('join:driver')
  @SocketTenantScoped()
  async handleJoinDriver(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { driverId: string },
  ) {
    if (!data?.driverId) return;
    client.join(`driver:${data.driverId}`);
    this.logger.log(
      `[Rides] Driver ${client.data.userId} joined room driver:${data.driverId}`,
    );
    client.emit('joined:driver', { room: `driver:${data.driverId}` });

    // S221 — Marquer le driver online + mettre à jour lastActive
    this.prisma.driverProfile.update({
      where: { id: data.driverId },
      data: { isOnline: true, lastActive: new Date() },
    }).catch(() => {});

    // Re-envoyer le booking pending s'il en existe un (rattrapage de race condition)
    // Seulement si l'encoche du chauffeur est active (isAvailable)
    try {
      const profile = await this.prisma.driverProfile.findUnique({ where: { id: data.driverId }, select: { isAvailable: true } });
      if (!profile?.isAvailable) return;

      const pending = await this.prisma.booking.findFirst({
        where: { driverProfileId: data.driverId, status: 'pending' },
        include: { passenger: { select: { name: true, avatarUrl: true, status: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (pending) {
        const seats: Record<string, number> = {
          eco: 4, eco_plus: 4, standard: 5, confort: 5, confort_plus: 7,
        };
        const etaMin = pending.driverEtaMinutes ?? 10;
        const passengerTrustScore = await this.trustScore
          .computeScore(pending.passengerId)
          .catch(() => 5.0);
        const isFavoritePassenger = await this.favorites
          .isFavorite(pending.passengerId, data.driverId)
          .catch(() => false);
        client.emit('booking:new_request', {
          id: pending.id,
          passengerId: pending.passengerId,
          meetAndGreet: (pending as any).meetAndGreet ?? false,
          isFavoritePassenger,
          passengerName: pending.passenger?.name ?? null,
          passengerAvatarUrl: pending.passenger?.avatarUrl ?? null,
          passengerVerified: pending.passenger?.status === 'active',
          passengerTrustScore,
          flightNumber: pending.flightNumber,
          destination: pending.destination,
          vehicleType: pending.vehicleType,
          estimatedPrice: pending.estimatedPrice,
          departureAirport: pending.departureAirport,
          type: pending.type,
          pickupAddress: pending.pickupAddress,
          pricingMode: (pending as any).pricingMode ?? 'kilometrage',
          seats: seats[pending.vehicleType] ?? 4,
          distanceKm: parseFloat((etaMin * 0.5).toFixed(1)),
          durationMin: etaMin,
        });
        this.logger.log(`[Rides] Re-sent pending booking ${pending.id} to driver ${data.driverId}`);
      }
    } catch { /* non bloquant */ }
  }

  /**
   * Notify a specific driver about a new booking request. 
   * Used for broad broadcast (Pre-landing) and targeted broadcast (Post-landing).
   */
  async notifyNewBooking(driverId: string, data: any) {
    const seats: Record<string, number> = {
      eco: 4, eco_plus: 4, standard: 5, confort: 5, confort_plus: 7,
    };

    // Lot 2 — badge « client fidèle » : ce passager a-t-il ce chauffeur en favori ?
    const isFavoritePassenger = data.passengerId
      ? await this.favorites.isFavorite(data.passengerId, driverId).catch(() => false)
      : false;

    this.server.to(`driver:${driverId}`).emit('booking:new_request', {
      ...data,
      seats: seats[data.vehicleType] ?? 4,
      meetAndGreet: data.meetAndGreet ?? false,
      isFavoritePassenger,
    });

    this.logger.log(`[Rides] Notified driver ${driverId} about booking ${data.id}`);
  }

  notifyPassenger(passengerId: string, event: string, data: any) {
    this.server.to(`passenger:${passengerId}`).emit(event, data);
  }
}
