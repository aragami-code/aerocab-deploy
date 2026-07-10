import { Injectable, Logger } from '@nestjs/common';
import { IWhatsAppProvider } from './interfaces/whatsapp-provider.interface';
import { MockWhatsAppProvider } from './providers/mock-whatsapp.provider';
import { UltramsgProvider } from './providers/ultramsg.provider';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class WhatsAppRouter {
  private readonly logger = new Logger(WhatsAppRouter.name);

  constructor(
    private readonly mock: MockWhatsAppProvider,
    private readonly ultramsg: UltramsgProvider,
    private readonly settings: SettingsService,
  ) {}

  async send(to: string, message: string, country: string | null = null): Promise<boolean> {
    const name = await this.settings.getForCountry('whatsapp_provider', country, 'mock');
    if (name === 'ultramsg') {
      this.logger.log(`WhatsApp via ultramsg → ${to.slice(0, 6)}***`);
      return this.ultramsg.sendForCountry(to, message, country);
    }
    if (name !== 'mock') {
      this.logger.warn(`whatsapp_provider inconnu '${name}' — fallback mock`);
    }
    return this.mock.send(to, message);
  }
}
