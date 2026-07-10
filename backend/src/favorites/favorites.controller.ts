import { Controller, Post, Get, Param, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser } from '../auth/decorators';
import { FavoritesService } from './favorites.service';

@Controller()
@SkipThrottle()
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Post('drivers/:driverId/favorite')
  toggle(@CurrentUser('id') userId: string, @Param('driverId') driverId: string) {
    return this.favorites.toggle(userId, driverId);
  }

  @Get('me/favorites')
  list(@CurrentUser('id') userId: string) {
    return this.favorites.list(userId);
  }
}
