import { Controller, Get, Patch, Put, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { CurrentUser } from '../auth/decorators';
import { IsBoolean, IsString, IsNotEmpty, IsArray, ValidateNested, Matches, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

// Clés gérées par des endpoints dédiés — le patch générique est bloqué pour éviter les incohérences
// TODO Phase 6 : remplacer par @RequirePermission() granulaire
const DEDICATED_ENDPOINT_KEYS = ['sms_routing_rules', 'email_provider'];

const SMS_PROVIDERS = ['mock', 'twilio', 'orange-cm', 'africas-talking'] as const;

class SmsRoutingRuleDto {
  @IsString()
  @Matches(/^\+\d{1,4}$/, { message: 'Le préfixe doit être au format E.164 : +237, +221, etc.' })
  prefix!: string;

  @IsIn(SMS_PROVIDERS)
  provider!: string;
}

class SetSmsRoutingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SmsRoutingRuleDto)
  rules!: SmsRoutingRuleDto[];

  @IsIn(SMS_PROVIDERS)
  defaultProvider!: string;
}

class SetProximityDto {
  @IsBoolean()
  enabled!: boolean;
}

class SetAppSettingDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  value!: string;
}

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SettingsController {
  constructor(private settings: SettingsService, private audit: AuditService) {}

  @Get()
  getAll() {
    return this.settings.getAll();
  }

  @Patch('key')
  async setKey(@Body() dto: SetAppSettingDto) {
    // TODO Phase 6 : vérifier permission granulaire via @RequirePermission()
    // Pour l'instant : les clés sensibles nécessitent un rôle admin (déjà garanti par @Roles)
    // Cette liste bloque l'édition directe des clés sensibles — utiliser les endpoints dédiés
    if (DEDICATED_ENDPOINT_KEYS.includes(dto.key)) {
      throw new ForbiddenException(
        `La clé '${dto.key}' est gérée par un endpoint dédié. Utilisez /admin/settings/sms-routing ou /admin/settings/email-provider.`,
      );
    }
    await this.settings.set(dto.key, dto.value);
    return { key: dto.key, value: dto.value };
  }

  // ── SMS Routing ────────────────────────────────────────────────────────────

  /**
   * GET /admin/settings/sms-routing
   * TODO Phase 6 : @RequirePermission('manage_sms_providers') — super_admin uniquement
   */
  @Get('sms-routing')
  async getSmsRouting() {
    const raw = await this.settings.get('sms_routing_rules');
    let parsed: Record<string, string> = { default: 'mock' };
    if (raw) {
      try { parsed = JSON.parse(raw); } catch { /* keep default */ }
    }
    const rules = Object.entries(parsed)
      .filter(([k]) => k !== 'default')
      .map(([prefix, provider]) => ({ prefix, provider }));
    return {
      rules,
      defaultProvider: parsed['default'] ?? 'mock',
      availableProviders: SMS_PROVIDERS,
    };
  }

  /**
   * PUT /admin/settings/sms-routing
   * TODO Phase 6 : @RequirePermission('manage_sms_providers') — super_admin uniquement
   */
  @Put('sms-routing')
  async setSmsRouting(@Body() dto: SetSmsRoutingDto, @CurrentUser() admin: any) {
    const rulesObj: Record<string, string> = { default: dto.defaultProvider };
    for (const rule of dto.rules) {
      rulesObj[rule.prefix] = rule.provider;
    }
    await this.settings.set('sms_routing_rules', JSON.stringify(rulesObj));
    this.audit.log({
      action: 'UPDATE_SMS_ROUTING',
      entity: 'AppSetting',
      adminId: admin.id,
      meta: { rules: dto.rules, defaultProvider: dto.defaultProvider },
    }).catch(() => {});
    return { rules: dto.rules, defaultProvider: dto.defaultProvider };
  }

  // ── Email provider ─────────────────────────────────────────────────────────

  /**
   * GET /admin/settings/email-provider
   * TODO Phase 6 : @RequirePermission('manage_email_providers') — super_admin uniquement
   */
  @Get('email-provider')
  async getEmailProvider() {
    const provider = await this.settings.get('email_provider') ?? 'mock';
    return { provider, availableProviders: ['mock', 'sendgrid', 'smtp'] };
  }

  /**
   * PUT /admin/settings/email-provider
   * TODO Phase 6 : @RequirePermission('manage_email_providers') — super_admin uniquement
   */
  @Put('email-provider')
  async setEmailProvider(@Body() body: { provider: string }, @CurrentUser() admin: any) {
    const allowed = ['mock', 'sendgrid', 'smtp'];
    if (!allowed.includes(body.provider)) {
      throw new ForbiddenException(`Provider invalide. Valeurs acceptées : ${allowed.join(', ')}`);
    }
    await this.settings.set('email_provider', body.provider);
    this.audit.log({
      action: 'UPDATE_EMAIL_PROVIDER',
      entity: 'AppSetting',
      adminId: admin.id,
      meta: { provider: body.provider },
    }).catch(() => {});
    return { provider: body.provider };
  }

  // ── Proximity assignment ───────────────────────────────────────────────────

  @Get('proximity-assignment')
  async getProximity() {
    const enabled = await this.settings.isProximityAssignmentEnabled();
    return { proximityAssignment: enabled };
  }

  @Patch('proximity-assignment')
  async setProximity(@Body() dto: SetProximityDto) {
    await this.settings.setProximityAssignment(dto.enabled);
    return { proximityAssignment: dto.enabled };
  }
}
