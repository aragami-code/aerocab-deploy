import { Controller, Post, Get, Body, Query, Res, UseGuards, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendOtpDto, VerifyOtpDto, RefreshTokenDto } from './dto';
import { JwtAuthGuard } from './guards';
import { CurrentUser } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('otp/send')
  @HttpCode(200)
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.phone);
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phone, dto.code, dto.intendedRole);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Post('google')
  @HttpCode(200)
  googleLogin(@Body() body: { code: string; codeVerifier: string; redirectUri: string }) {
    return this.authService.googleLogin(body.code, body.codeVerifier, body.redirectUri);
  }

  @Get('google/start')
  googleStart(@Query('deepLink') deepLink: string, @Res() res: any) {
    return this.authService.googleStart(deepLink, res);
  }

  @Get('google/callback')
  googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: any,
  ) {
    // Google renvoie error=access_denied si l'utilisateur refuse, ou redirect_uri_mismatch etc.
    if (error || !code) {
      const deepLink = state ? Buffer.from(state, 'base64').toString('utf8') : '';
      return res.redirect(`${deepLink || 'landingride-passenger://'}?error=${error || 'no_code'}`);
    }
    return this.authService.googleCallback(code, state, res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }
}
