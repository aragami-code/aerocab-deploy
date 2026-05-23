import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { TrustScoreService } from './trust-score.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser } from '../auth/decorators';

import { SkipThrottle } from '@nestjs/throttler';
@SkipThrottle()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private usersService: UsersService,
    private trustScore: TrustScoreService,
  ) {}

  @Get('me')
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Delete('me')
  async deleteAccount(@CurrentUser('id') userId: string) {
    return this.usersService.deleteAccount(userId);
  }

  @Get('me/loyalty')
  async getLoyaltyStatus(@CurrentUser('id') userId: string) {
    return this.usersService.getLoyaltyStatus(userId);
  }

  @Get('me/trust-score')
  async getTrustScore(@CurrentUser('id') userId: string) {
    const score = await this.trustScore.computeScore(userId);
    return {
      score,
      label: this.trustScore.scoreLabel(score),
      color: this.trustScore.scoreColor(score),
    };
  }

  @Get('me/pass-status')
  async getPassStatus(@CurrentUser('id') userId: string) {
    return this.usersService.getPassStatus(userId);
  }
}
