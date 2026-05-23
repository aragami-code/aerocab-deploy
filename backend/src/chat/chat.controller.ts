import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { AuthGuard } from '@nestjs/passport';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { SkipThrottle } from '@nestjs/throttler';

const UPLOAD_DIR = '/tmp/aerogo24-uploads';
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
};

@SkipThrottle()
@Controller('chat')
@UseGuards(AuthGuard('jwt'))
export class ChatController {
  constructor(
    private chatService: ChatService,
    private chatGateway: ChatGateway,
  ) {}

  @Post('conversations')
  async startConversation(
    @Request() req: { user: { id: string } },
    @Body() body: { driverId?: string; otherUserId?: string; flightId?: string },
  ) {
    if (body.otherUserId) {
      return this.chatService.findOrCreateConversation(req.user.id, body.otherUserId);
    }
    return this.chatService.startConversation(req.user.id, body.driverId!, body.flightId);
  }

  @Get('conversations')
  async getConversations(@Request() req: { user: { id: string } }) {
    return this.chatService.getConversations(req.user.id);
  }

  @Get('conversations/:id/messages')
  async getMessages(
    @Request() req: { user: { id: string } },
    @Param('id') conversationId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatService.getMessages(
      conversationId,
      req.user.id,
      cursor,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Request() req: { user: { id: string } },
    @Param('id') conversationId: string,
    @Body() body: { content: string; mediaUrl?: string; mediaType?: string },
  ) {
    const message = await this.chatService.sendMessage(
      conversationId,
      req.user.id,
      body.content ?? '',
      body.mediaUrl,
      body.mediaType,
    );
    // Diffuser via socket pour la livraison temps réel (fallback REST)
    this.chatGateway.server
      .to(`conversation:${conversationId}`)
      .emit('new_message', message);
    return message;
  }

  @Post('conversations/:id/media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const ext = MIME_TO_EXT[file.mimetype] ?? '.jpg';
          cb(null, `chat-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!MIME_TO_EXT[file.mimetype]) {
          return cb(new BadRequestException('Formats acceptés : JPG, PNG, WebP'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadMedia(
    @Request() req: { user: { id: string } },
    @Param('id') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    await this.chatService.verifyAccess(conversationId, req.user.id);
    return {
      url: `/api/chat-images/${file.filename}`,
      mediaType: file.mimetype,
      filename: file.filename,
    };
  }

  @Post('conversations/:id/read')
  async markAsRead(
    @Request() req: { user: { id: string } },
    @Param('id') conversationId: string,
  ) {
    return this.chatService.markAsRead(conversationId, req.user.id);
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: { user: { id: string } }) {
    return this.chatService.getUnreadCount(req.user.id);
  }
}
