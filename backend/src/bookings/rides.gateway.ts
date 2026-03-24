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

/**
 * Gateway principal (namespace /) pour les chauffeurs.
 * Le driver SDK se connecte sans namespace : io(SOCKET_URL, { auth: { token } })
 *
 * Rooms :
 *   driver:{driverProfileId}   — room personnelle du chauffeur
 *   passenger:{userId}          — room personnelle du passager (pour notifs de statut)
 */
@WebSocketGateway({
  cors: { origin: '*' },
})
export class RidesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RidesGateway.name);
  private userSockets = new Map<string, string[]>();

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
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

      // Joindre automatiquement la room passager
      if (payload.role === 'passenger') {
        client.join(`passenger:${payload.sub}`);
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

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      const sockets = this.userSockets.get(userId) || [];
      const filtered = sockets.filter((id) => id !== client.id);
      if (filtered.length > 0) {
        this.userSockets.set(userId, filtered);
      } else {
        this.userSockets.delete(userId);
      }
    }
    this.logger.log(`[Rides] Client disconnected: ${client.id}`);
  }

  /**
   * Le chauffeur rejoint sa room personnelle après connexion.
   * emit('join:driver', { driverId: profile.id })
   */
  @SubscribeMessage('join:driver')
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

    // Re-envoyer le booking pending s'il en existe un (rattrapage de race condition)
    try {
      const pending = await this.prisma.booking.findFirst({
        where: { driverProfileId: data.driverId, status: 'pending' },
        include: { passenger: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (pending) {
        const seats: Record<string, number> = {
          eco: 4, eco_plus: 4, standard: 5, confort: 5, confort_plus: 7,
        };
        client.emit('booking:new_request', {
          id: pending.id,
          passengerId: pending.passengerId,
          passengerName: pending.passenger?.name ?? null,
          flightNumber: pending.flightNumber,
          destination: pending.destination,
          vehicleType: pending.vehicleType,
          estimatedPrice: pending.estimatedPrice,
          departureAirport: pending.departureAirport,
          seats: seats[pending.vehicleType] ?? 4,
        });
        this.logger.log(`[Rides] Re-sent pending booking ${pending.id} to driver ${data.driverId}`);
      }
    } catch { /* non bloquant */ }
  }

  /**
   * Notify a specific driver about a new booking request. 
   * Used for broad broadcast (Pre-landing) and targeted broadcast (Post-landing).
   */
  notifyNewBooking(driverId: string, data: any) {
    const seats: Record<string, number> = {
      eco: 4, eco_plus: 4, standard: 5, confort: 5, confort_plus: 7,
    };
    
    this.server.to(`driver:${driverId}`).emit('booking:new_request', {
      ...data,
      seats: seats[data.vehicleType] ?? 4,
    });
    
    this.logger.log(`[Rides] Notified driver ${driverId} about booking ${data.id}`);
  }
}
