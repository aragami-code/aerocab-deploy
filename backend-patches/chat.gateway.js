"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ChatGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const chat_service_1 = require("./chat.service");
let ChatGateway = ChatGateway_1 = class ChatGateway {
    constructor(jwtService, chatService) {
        this.jwtService = jwtService;
        this.chatService = chatService;
        this.logger = new common_1.Logger(ChatGateway_1.name);
        this.userSockets = new Map();
    }
    async handleConnection(client) {
        var _a, _b;
        try {
            const token = ((_a = client.handshake.auth) === null || _a === void 0 ? void 0 : _a.token) || ((_b = client.handshake.query) === null || _b === void 0 ? void 0 : _b.token);
            if (!token) {
                client.disconnect();
                return;
            }
            const payload = this.jwtService.verify(token);
            const userId = payload.sub;
            client.data.userId = userId;
            // Track user sockets
            const sockets = this.userSockets.get(userId) || [];
            sockets.push(client.id);
            this.userSockets.set(userId, sockets);
            this.logger.log(`Client connected: ${client.id} (user: ${userId})`);
        }
        catch (_c) {
            client.disconnect();
        }
    }
    handleDisconnect(client) {
        const userId = client.data.userId;
        if (userId) {
            const sockets = this.userSockets.get(userId) || [];
            const filtered = sockets.filter((id) => id !== client.id);
            if (filtered.length > 0) {
                this.userSockets.set(userId, filtered);
            }
            else {
                this.userSockets.delete(userId);
            }
        }
        this.logger.log(`Client disconnected: ${client.id}`);
    }
    async handleJoin(client, data) {
        client.join(`conversation:${data.conversationId}`);
        this.logger.log(`User ${client.data.userId} joined conversation ${data.conversationId}`);
    }
    async handleLeave(client, data) {
        client.leave(`conversation:${data.conversationId}`);
    }
    async handleMessage(client, data) {
        const userId = client.data.userId;
        if (!userId)
            return;
        try {
            const message = await this.chatService.sendMessage(data.conversationId, userId, data.content);
            // Broadcast to all in conversation room
            this.server
                .to(`conversation:${data.conversationId}`)
                .emit('new_message', message);
            return { success: true, message };
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Erreur envoi message';
            return { success: false, error: errMsg };
        }
    }
    async handleTyping(client, data) {
        client
            .to(`conversation:${data.conversationId}`)
            .emit('user_typing', {
            userId: client.data.userId,
            isTyping: data.isTyping,
        });
    }
    async handleRead(client, data) {
        const userId = client.data.userId;
        if (!userId)
            return;
        await this.chatService.markAsRead(data.conversationId, userId);
        client
            .to(`conversation:${data.conversationId}`)
            .emit('messages_read', { userId });
    }
};
exports.ChatGateway = ChatGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], ChatGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('join'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleJoin", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('leave'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleLeave", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('message'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleMessage", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('typing'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleTyping", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('read'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleRead", null);
exports.ChatGateway = ChatGateway = ChatGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: { origin: '*' },
        namespace: '/chat',
    }),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        chat_service_1.ChatService])
], ChatGateway);
//# sourceMappingURL=chat.gateway.js.map