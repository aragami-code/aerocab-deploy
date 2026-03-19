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

  constructor(private jwtService: JwtService) {}

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
  handleJoinDriver(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { driverId: string },
  ) {
    if (!data?.driverId) return;
    client.join(`driver:${data.driverId}`);
    this.logger.log(
      `[Rides] Driver ${client.data.userId} joined room driver:${data.driverId}`,
    );
    client.emit('joined:driver', { room: `driver:${data.driverId}` });
  }
}
