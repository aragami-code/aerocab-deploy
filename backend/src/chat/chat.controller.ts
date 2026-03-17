import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(AuthGuard('jwt'))
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('conversations')
  async startConversation(
    @Request() req: { user: { id: string } },
    @Body() body: { driverId: string; flightId?: string },
  ) {
    return this.chatService.startConversation(
      req.user.id,
      body.driverId,
      body.flightId,
    );
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
    @Body() body: { content: string },
  ) {
    return this.chatService.sendMessage(
      conversationId,
      req.user.id,
      body.content,
    );
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
