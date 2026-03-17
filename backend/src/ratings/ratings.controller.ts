import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RatingsService } from './ratings.service';

@Controller('ratings')
@UseGuards(AuthGuard('jwt'))
export class RatingsController {
  constructor(private ratingsService: RatingsService) {}

  @Post()
  async create(
    @Req() req: any,
    @Body()
    body: {
      toUserId: string;
      conversationId: string;
      score: number;
      comment?: string;
    },
  ) {
    return this.ratingsService.createRating(req.user.id, body);
  }

  @Get('driver/:driverId')
  async getDriverRatings(
    @Param('driverId') driverId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ratingsService.getDriverRatings(
      driverId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Get('check/:conversationId')
  async checkIfRated(
    @Req() req: any,
    @Param('conversationId') conversationId: string,
  ) {
    const hasRated = await this.ratingsService.hasRated(
      req.user.id,
      conversationId,
    );
    return { hasRated };
  }

  @Get('summary/:userId')
  async getUserSummary(@Param('userId') userId: string) {
    return this.ratingsService.getUserRatingsSummary(userId);
  }
}
