import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { BotService } from './bot.service';
import { SendBotMessageDto } from './dto/chat-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('bot')
@UseGuards(JwtAuthGuard)
export class BotController {
  constructor(private botService: BotService) {}

  @Post('message')
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Body() body: SendBotMessageDto,
  ) {
    return this.botService.chat(userId, body.message, body.history ?? []);
  }
}
