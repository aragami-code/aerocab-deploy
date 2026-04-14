import { Injectable, Logger } from '@nestjs/common';
import { ISmsProvider } from '../interfaces/sms-provider.interface';

@Injectable()
export class MockSmsProvider implements ISmsProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockSmsProvider.name);

  async send(to: string, message: string): Promise<boolean> {
    this.logger.log(`[MockSMS] To: ${to} | Message: ${message}`);
    return true;
  }
}
