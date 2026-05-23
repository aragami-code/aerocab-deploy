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
import { ChatService } from './chat.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private userSockets = new Map<string, string[]>();

  constructor(
    private jwtService: JwtService,
    private chatService: ChatService,
  ) {}

  async handleConnection(client: Socket) {
    this.logger.log(`[Chat] connection attempt ${client.id} origin=${client.handshake.headers?.origin ?? 'none'}`);
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token;
      if (!token) {
        this.logger.warn(`[Chat] disconnect ${client.id} — no token in handshake.auth nor handshake.query`);
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token as string);
      const userId = payload.sub;
      client.data.userId = userId;

      const sockets = this.userSockets.get(userId) || [];
      sockets.push(client.id);
      this.userSockets.set(userId, sockets);

      this.logger.log(`[Chat] connected ${client.id} user=${userId}`);
    } catch (err: any) {
      this.logger.warn(`[Chat] disconnect ${client.id} — auth error: ${err?.message ?? err}`);
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
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    client.join(`conversation:${data.conversationId}`);
    this.logger.log(`User ${client.data.userId} joined conversation ${data.conversationId}`);
  }

  @SubscribeMessage('leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    client.leave(`conversation:${data.conversationId}`);
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      conversationId: string;
      content: string;
      mediaUrl?: string;
      mediaType?: string;
    },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    try {
      const message = await this.chatService.sendMessage(
        data.conversationId,
        userId,
        data.content ?? '',
        data.mediaUrl,
        data.mediaType,
      );

      this.server
        .to(`conversation:${data.conversationId}`)
        .emit('new_message', message);

      return { success: true, message };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Erreur envoi message';
      return { success: false, error: errMsg };
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; isTyping: boolean },
  ) {
    client.to(`conversation:${data.conversationId}`).emit('user_typing', {
      userId: client.data.userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('read')
  async handleRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    await this.chatService.markAsRead(data.conversationId, userId);
    client.to(`conversation:${data.conversationId}`).emit('messages_read', { userId });
  }
}
