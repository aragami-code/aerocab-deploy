import { Controller, Post, Get, Put, Body, Request, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { CallsProxyService } from './calls-proxy.service';

class InitiateProxyCallDto {
  bookingId!: string;
}

class SaveTelephonyConfigDto {
  callsProvider!: 'webrtc' | 'twilio_proxy';
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioProxyServiceSid?: string;
}

/** POST /calls/proxy — passager ou chauffeur initie un appel masqué */
@Controller('calls')
@UseGuards(JwtAuthGuard)
@SkipThrottle()
export class CallsProxyController {
  constructor(private proxyService: CallsProxyService) {}

  @Post('proxy')
  async initiateProxyCall(
    @Request() req: { user: { id: string } },
    @Body() body: InitiateProxyCallDto,
  ) {
    return this.proxyService.initiateProxyCall(req.user.id, body.bookingId);
  }
}

/** Routes admin — GET/PUT /admin/settings/telephony */
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@SkipThrottle()
export class TelephonySettingsController {
  constructor(private proxyService: CallsProxyService) {}

  @Get('telephony')
  getTelephony() {
    return this.proxyService.getTelephonyConfig();
  }

  @Put('telephony')
  saveTelephony(@Body() body: SaveTelephonyConfigDto) {
    return this.proxyService.saveTelephonyConfig(body);
  }
}
