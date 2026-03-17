import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly isDev: boolean;

  constructor(private configService: ConfigService) {
    this.isDev = configService.get('NODE_ENV', 'development') !== 'production';
  }

  async sendOtp(phone: string, code: string): Promise<boolean> {
    if (this.isDev) {
      this.logger.log(`[DEV] OTP for ${phone}: ${code}`);
      return true;
    }

    // Production: Twilio integration
    try {
      const accountSid = this.configService.get('TWILIO_ACCOUNT_SID');
      const authToken = this.configService.get('TWILIO_AUTH_TOKEN');
      const fromNumber = this.configService.get('TWILIO_PHONE_NUMBER');

      if (!accountSid || !authToken || !fromNumber) {
        this.logger.error('Twilio credentials not configured');
        return false;
      }

      // TODO: Install twilio package in production
      // const twilio = require('twilio');
      // const client = twilio(accountSid, authToken);
      // await client.messages.create({
      //   body: `AeroCab Connect - Votre code de verification: ${code}`,
      //   from: fromNumber,
      //   to: phone,
      // });

      this.logger.warn('Twilio not configured - OTP not sent in production');
      return false;
    } catch (error) {
      this.logger.error(`Failed to send OTP to ${phone}`, error);
      return false;
    }
  }
}
