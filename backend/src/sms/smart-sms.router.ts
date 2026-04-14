import { Injectable, Logger } from '@nestjs/common';
import { parsePhoneNumber } from 'libphonenumber-js';
import { ISmsProvider } from './interfaces/sms-provider.interface';
import { MockSmsProvider } from './providers/mock-sms.provider';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';
import { OrangeCmProvider } from './providers/orange-cm.provider';
import { AfricasTalkingProvider } from './providers/africas-talking.provider';
import { SettingsService } from '../settings/settings.service';

/**
 * AppSetting `sms_routing_rules` format (JSON):
 * {
 *   "+237": "orange-cm",      // Cameroun
 *   "+221": "africas-talking", // Sénégal
 *   "+225": "africas-talking", // Côte d'Ivoire
 *   "default": "twilio"
 * }
 */
@Injectable()
export class SmartSmsRouter {
  private readonly logger = new Logger(SmartSmsRouter.name);

  constructor(
    private readonly mock: MockSmsProvider,
    private readonly twilio: TwilioSmsProvider,
    private readonly orangeCm: OrangeCmProvider,
    private readonly africasTalking: AfricasTalkingProvider,
    private readonly settings: SettingsService,
  ) {}

  private get providers(): Record<string, ISmsProvider> {
    return {
      mock: this.mock,
      twilio: this.twilio,
      'orange-cm': this.orangeCm,
      'africas-talking': this.africasTalking,
    };
  }

  private extractCountryCode(phone: string): string {
    try {
      const parsed = parsePhoneNumber(phone);
      if (parsed?.countryCallingCode) {
        return `+${parsed.countryCallingCode}`;
      }
    } catch {
      // fallback to manual prefix extraction
    }
    // Fallback: try E.164 prefix heuristic
    const digits = phone.startsWith('+') ? phone : `+${phone}`;
    for (const len of [4, 3, 2, 1]) {
      const prefix = digits.slice(0, len + 1);
      if (/^\+\d+$/.test(prefix)) return prefix;
    }
    return '';
  }

  async send(to: string, message: string): Promise<boolean> {
    const provider = await this.resolveProvider(to);
    this.logger.log(`SMS via ${provider.name} → ${to.slice(0, 6)}***`);
    return provider.send(to, message);
  }

  private async resolveProvider(to: string): Promise<ISmsProvider> {
    const rulesRaw = await this.settings.get('sms_routing_rules');
    let rules: Record<string, string> = { default: 'mock' };

    if (rulesRaw) {
      try {
        rules = JSON.parse(rulesRaw);
      } catch {
        this.logger.warn('sms_routing_rules invalide — fallback mock');
      }
    }

    const countryCode = this.extractCountryCode(to);

    // Match longest prefix first
    const prefixes = Object.keys(rules)
      .filter(k => k !== 'default')
      .sort((a, b) => b.length - a.length);

    for (const prefix of prefixes) {
      if (countryCode.startsWith(prefix)) {
        const providerName = rules[prefix];
        const provider = this.providers[providerName];
        if (provider) return provider;
        this.logger.warn(`Provider inconnu '${providerName}' pour ${prefix} — fallback`);
        break;
      }
    }

    const defaultName = rules['default'] ?? 'mock';
    return this.providers[defaultName] ?? this.mock;
  }
}
