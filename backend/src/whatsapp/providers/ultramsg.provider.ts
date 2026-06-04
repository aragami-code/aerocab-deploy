import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IWhatsAppProvider } from '../interfaces/whatsapp-provider.interface';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class UltramsgProvider implements IWhatsAppProvider {
  readonly name = 'ultramsg';
  private readonly logger = new Logger(UltramsgProvider.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  /** country threadé par le router pour les creds par pays (cascade). */
  async sendForCountry(to: string, message: string, country: string | null): Promise<boolean> {
    const SENTINEL = ' ';
    const instDb  = await this.settings.getForCountry('whatsapp_ultramsg_instance', country, SENTINEL);
    const tokenDb = await this.settings.getForCountry('whatsapp_ultramsg_token', country, SENTINEL);
    const instance = (instDb !== SENTINEL && instDb) ? instDb : this.config.get<string>('ULTRAMSG_INSTANCE', '');
    const token    = (tokenDb !== SENTINEL && tokenDb) ? tokenDb : this.config.get<string>('ULTRAMSG_TOKEN', '');

    if (!instance || !token) {
      this.logger.error('Ultramsg credentials manquants (whatsapp_ultramsg_instance/token ou env)');
      return false;
    }
    const phone = to.startsWith('+') ? to.slice(1) : to;
    try {
      const res = await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, to: phone, body: message }).toString(),
      });
      if (!res.ok) {
        this.logger.error(`Ultramsg error ${res.status}`);
        return false;
      }
      const data = await res.json() as any;
      if (data?.sent === 'true' || data?.sent === true) return true;
      this.logger.error(`Ultramsg refus: ${JSON.stringify(data).slice(0, 200)}`);
      return false;
    } catch (e: any) {
      this.logger.error(`Ultramsg send failed: ${e.message}`);
      return false;
    }
  }

  send(to: string, message: string): Promise<boolean> {
    return this.sendForCountry(to, message, null);
  }
}
