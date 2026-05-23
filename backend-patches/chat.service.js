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
var ChatService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
let ChatService = ChatService_1 = class ChatService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(ChatService_1.name);
    }
    async startConversation(passengerId, driverId, flightId) {
        // Verify driver exists and is approved
        const driver = await this.prisma.driverProfile.findFirst({
            where: { userId: driverId, status: 'approved' },
        });
        if (!driver) {
            throw new common_1.NotFoundException('Chauffeur introuvable ou non approuve');
        }
        // Check if conversation already exists
        const existing = await this.prisma.conversation.findFirst({
            where: Object.assign(Object.assign({ passengerId,
                driverId }, (flightId ? { flightId } : {})), { status: 'active' }),
            include: {
                messages: { orderBy: { createdAt: 'desc' }, take: 1 },
                driver: { select: { id: true, name: true, avatarUrl: true } },
                passenger: { select: { id: true, name: true, avatarUrl: true } },
            },
        });
        if (existing) {
            return existing;
        }
        const conversation = await this.prisma.conversation.create({
            data: Object.assign({ passengerId,
                driverId }, (flightId ? { flightId } : {})),
            include: {
                driver: { select: { id: true, name: true, avatarUrl: true } },
                passenger: { select: { id: true, name: true, avatarUrl: true } },
                flight: {
                    select: {
                        id: true,
                        flightNumber: true,
                        airline: true,
                        scheduledArrival: true,
                    },
                },
            },
        });
        this.logger.log(`Conversation created: ${conversation.id}`);
        return conversation;
    }
    async getConversations(userId) {
        return this.prisma.conversation.findMany({
            where: {
                OR: [{ passengerId: userId }, { driverId: userId }],
            },
            include: {
                driver: { select: { id: true, name: true, avatarUrl: true } },
                passenger: { select: { id: true, name: true, avatarUrl: true } },
                flight: {
                    select: { flightNumber: true, scheduledArrival: true },
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { content: true, createdAt: true, senderId: true, readAt: true },
                },
            },
            orderBy: { updatedAt: 'desc' },
        });
    }
    async getMessages(conversationId, userId, cursor, limit = 50) {
        // Verify user is part of conversation
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
        });
        if (!conversation) {
            throw new common_1.NotFoundException('Conversation introuvable');
        }
        if (conversation.passengerId !== userId && conversation.driverId !== userId) {
            throw new common_1.ForbiddenException('Acces non autorise');
        }
        const messages = await this.prisma.message.findMany({
            where: Object.assign({ conversationId }, (cursor ? { createdAt: { lt: new Date(cursor) } } : {})),
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true,
                content: true,
                senderId: true,
                readAt: true,
                createdAt: true,
            },
        });
        return messages.reverse();
    }
    async sendMessage(conversationId, senderId, content) {
        if (!content.trim()) {
            throw new common_1.BadRequestException('Le message ne peut pas etre vide');
        }
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
        });
        if (!conversation) {
            throw new common_1.NotFoundException('Conversation introuvable');
        }
        if (conversation.passengerId !== senderId && conversation.driverId !== senderId) {
            throw new common_1.ForbiddenException('Acces non autorise');
        }
        if (conversation.status !== 'active') {
            throw new common_1.BadRequestException('Cette conversation est fermee');
        }
        const message = await this.prisma.message.create({
            data: {
                conversationId,
                senderId,
                content: content.trim(),
            },
            select: {
                id: true,
                content: true,
                senderId: true,
                readAt: true,
                createdAt: true,
            },
        });
        // Update conversation timestamp
        await this.prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
        });
        return message;
    }
    async markAsRead(conversationId, userId) {
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
        });
        if (!conversation) {
            throw new common_1.NotFoundException('Conversation introuvable');
        }
        if (conversation.passengerId !== userId && conversation.driverId !== userId) {
            throw new common_1.ForbiddenException('Acces non autorise');
        }
        await this.prisma.message.updateMany({
            where: {
                conversationId,
                senderId: { not: userId },
                readAt: null,
            },
            data: { readAt: new Date() },
        });
        return { success: true };
    }
    async getUnreadCount(userId) {
        const count = await this.prisma.message.count({
            where: {
                conversation: {
                    OR: [{ passengerId: userId }, { driverId: userId }],
                    status: 'active',
                },
                senderId: { not: userId },
                readAt: null,
            },
        });
        return { unreadCount: count };
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = ChatService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ChatService);
//# sourceMappingURL=chat.service.js.map