import { Injectable, Logger } from '@nestjs/common';
import { IWhatsAppProvider } from '../interfaces/whatsapp-provider.interface';

@Injectable()
export class MockWhatsAppProvider implements IWhatsAppProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockWhatsAppProvider.name);

  async send(to: string, message: string): Promise<boolean> {
    this.logger.log(`[WhatsApp MOCK] → ${to.slice(0, 6)}*** : ${message.slice(0, 40)}...`);
    return true;
  }
}
