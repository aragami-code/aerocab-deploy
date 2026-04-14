import { Controller, Post, Get, Body, Query, Res, UseGuards, HttpCode } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SendOtpDto, VerifyOtpDto, RefreshTokenDto } from './dto';
import { JwtAuthGuard } from './guards';
import { CurrentUser } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('otp/send')
  @HttpCode(200)
  @Throttle({ otp: { ttl: 60000, limit: 5 } })
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.phone, dto.lang ?? 'fr');
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ otp: { ttl: 60000, limit: 5 } })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phone, dto.code, dto.intendedRole, dto.referralCode);
  }

  @Get('referral')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  async getReferral(@CurrentUser('id') userId: string) {
    return this.authService.getReferralInfo(userId);
  }

  @Get('referral/list')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  async getReferralList(@CurrentUser('id') userId: string) {
    return this.authService.getReferralList(userId);
  }

  @Post('referral/apply')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ auth: { ttl: 60000, limit: 20 } })
  async applyReferral(@CurrentUser('id') userId: string, @Body() body: { code: string }) {
    return this.authService.applyReferral(userId, body.code);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ auth: { ttl: 60000, limit: 20 } })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Post('google')
  @HttpCode(200)
  @Throttle({ auth: { ttl: 60000, limit: 20 } })
  googleLogin(@Body() body: { code: string; codeVerifier: string; redirectUri: string; intendedRole?: 'passenger' | 'driver' }) {
    return this.authService.googleLogin(body.code, body.codeVerifier, body.redirectUri, body.intendedRole ?? 'passenger');
  }

  @Get('google/start')
  @SkipThrottle()
  googleStart(@Query('deepLink') deepLink: string, @Res() res: any) {
    return this.authService.googleStart(deepLink, res);
  }

  @Post('google/exchange')
  @HttpCode(200)
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  exchangeGoogleAuthCode(@Body() body: { authCode: string }) {
    return this.authService.exchangeGoogleAuthCode(body.authCode);
  }

  @Get('google/callback')
  @SkipThrottle()
  googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: any,
  ) {
    // Google renvoie error=access_denied si l'utilisateur refuse, ou redirect_uri_mismatch etc.
    if (error || !code) {
      const deepLink = state ? Buffer.from(state, 'base64').toString('utf8') : '';
      return res.redirect(`${deepLink || 'aerogo24-passenger://'}?error=${error || 'no_code'}`);
    }
    return this.authService.googleCallback(code, state, res);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @SkipThrottle()
  async logout(@CurrentUser('id') userId: string) {
    await this.authService.logout(userId);
    return { message: 'Déconnecté' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }
}
