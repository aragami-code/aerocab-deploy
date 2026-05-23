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

type CallState = {
  bookingId: string;
  callerUserId: string;
  calleeUserId: string;
  startedAt: number;
};

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/calls',
})
export class CallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallsGateway.name);
  private userSockets = new Map<string, string>();   // userId → socketId
  private activeCalls = new Map<string, CallState>(); // bookingId → CallState

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    this.logger.log(`[Calls] connection attempt ${client.id} origin=${client.handshake.headers?.origin ?? 'none'}`);
    try {
      const token = client.handshake.auth?.token ?? client.handshake.query?.token;
      if (!token) {
        this.logger.warn(`[Calls] disconnecting ${client.id} — no token`);
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token as string);
      client.data.userId = payload.sub;
      this.userSockets.set(payload.sub, client.id);
      this.logger.log(`[Calls] connected ${client.id} user=${payload.sub}`);
    } catch (err: any) {
      this.logger.warn(`[Calls] disconnecting ${client.id} — auth error: ${err?.message ?? err}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      this.userSockets.delete(userId);
      // If user was in a call, end it
      for (const [bookingId, state] of this.activeCalls.entries()) {
        if (state.callerUserId === userId || state.calleeUserId === userId) {
          const otherId = state.callerUserId === userId ? state.calleeUserId : state.callerUserId;
          this.emitToUser(otherId, 'call:ended', { bookingId, reason: 'disconnected' });
          this.activeCalls.delete(bookingId);
        }
      }
    }
  }

  // ── Initiation ────────────────────────────────────────────────────────────

  @SubscribeMessage('call:init')
  async handleInit(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string },
  ) {
    const userId = client.data.userId;
    if (!userId) return { error: 'Non authentifié' };

    const booking = await this.prisma.booking.findUnique({
      where: { id: data.bookingId },
      select: {
        id: true,
        status: true,
        passengerId: true,
        passenger: { select: { name: true } },
        driverProfile: {
          select: {
            userId: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    if (!booking) return { error: 'Réservation introuvable' };

    const validStatuses = ['confirmed', 'arrived_at_airport', 'in_progress', 'passenger_confirming'];
    if (!validStatuses.includes(booking.status)) {
      return { error: 'Appel non disponible sur cette course' };
    }

    const isPassenger = booking.passengerId === userId;
    const isDriver    = booking.driverProfile?.userId === userId;
    if (!isPassenger && !isDriver) return { error: 'Accès non autorisé' };

    if (this.activeCalls.has(data.bookingId)) {
      return { error: 'Un appel est déjà en cours' };
    }

    const calleeUserId = isPassenger
      ? booking.driverProfile!.userId
      : booking.passengerId;

    const callerName = isPassenger
      ? (booking.passenger?.name ?? 'Passager')
      : (booking.driverProfile?.user?.name ?? 'Chauffeur');

    const state: CallState = {
      bookingId:    data.bookingId,
      callerUserId: userId,
      calleeUserId,
      startedAt:    Date.now(),
    };
    this.activeCalls.set(data.bookingId, state);

    const sent = this.emitToUser(calleeUserId, 'call:incoming', {
      bookingId:  data.bookingId,
      callerName,
      callerRole: isPassenger ? 'passenger' : 'driver',
    });

    if (!sent) {
      this.activeCalls.delete(data.bookingId);
      return { error: 'Interlocuteur non connecté' };
    }

    // Auto-cancel after 30s if no response
    setTimeout(() => {
      if (this.activeCalls.has(data.bookingId)) {
        this.activeCalls.delete(data.bookingId);
        this.emitToUser(userId,       'call:timeout', { bookingId: data.bookingId });
        this.emitToUser(calleeUserId, 'call:timeout', { bookingId: data.bookingId });
      }
    }, 30_000);

    return { ok: true };
  }

  // ── Accept / Decline / End ────────────────────────────────────────────────

  @SubscribeMessage('call:accept')
  handleAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string },
  ) {
    const state = this.activeCalls.get(data.bookingId);
    if (!state || client.data.userId !== state.calleeUserId) return;

    this.emitToUser(state.callerUserId, 'call:accepted', { bookingId: data.bookingId });
  }

  @SubscribeMessage('call:decline')
  handleDecline(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string },
  ) {
    const state = this.activeCalls.get(data.bookingId);
    if (!state) return;

    const userId = client.data.userId;
    if (userId !== state.calleeUserId && userId !== state.callerUserId) return;

    this.activeCalls.delete(data.bookingId);
    const otherId = userId === state.callerUserId ? state.calleeUserId : state.callerUserId;
    this.emitToUser(otherId, 'call:declined', { bookingId: data.bookingId });
  }

  @SubscribeMessage('call:end')
  handleEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string },
  ) {
    const state = this.activeCalls.get(data.bookingId);
    if (!state) return;

    const userId = client.data.userId;
    if (userId !== state.callerUserId && userId !== state.calleeUserId) return;

    this.activeCalls.delete(data.bookingId);
    const otherId = userId === state.callerUserId ? state.calleeUserId : state.callerUserId;
    this.emitToUser(otherId, 'call:ended', { bookingId: data.bookingId, reason: 'hangup' });
  }

  // ── WebRTC Signaling ──────────────────────────────────────────────────────

  @SubscribeMessage('call:offer')
  handleOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string; sdp: unknown },
  ) {
    const state = this.activeCalls.get(data.bookingId);
    if (!state || client.data.userId !== state.callerUserId) return;

    this.emitToUser(state.calleeUserId, 'call:offer', { bookingId: data.bookingId, sdp: data.sdp });
  }

  @SubscribeMessage('call:answer')
  handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string; sdp: unknown },
  ) {
    const state = this.activeCalls.get(data.bookingId);
    if (!state || client.data.userId !== state.calleeUserId) return;

    this.emitToUser(state.callerUserId, 'call:answer', { bookingId: data.bookingId, sdp: data.sdp });
  }

  @SubscribeMessage('call:ice')
  handleIce(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string; candidate: unknown },
  ) {
    const state = this.activeCalls.get(data.bookingId);
    if (!state) return;

    const userId = client.data.userId;
    if (userId !== state.callerUserId && userId !== state.calleeUserId) return;

    const otherId = userId === state.callerUserId ? state.calleeUserId : state.callerUserId;
    this.emitToUser(otherId, 'call:ice', { bookingId: data.bookingId, candidate: data.candidate });
  }

  // ── Helper ────────────────────────────────────────────────────────────────

  private emitToUser(userId: string, event: string, data: unknown): boolean {
    const socketId = this.userSockets.get(userId);
    if (!socketId) return false;
    this.server.to(socketId).emit(event, data);
    return true;
  }
}
