import { Controller, Get, Patch, Put, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SettingsService } from './settings.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { CurrentUser } from '../auth/decorators';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { IsBoolean, IsString, IsNotEmpty, IsArray, ValidateNested, Matches, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

// Clés gérées par des endpoints dédiés — le patch générique est bloqué pour éviter les incohérences
const DEDICATED_ENDPOINT_KEYS = [
  'sms_routing_rules', 'email_provider',
  'test_mode_enabled', 'test_otp_value', 'otp_log_enabled', 'otp_channel',
  'google_maps_key', 'data_retention_months',
  // Credentials SMS/Email
  'twilio_account_sid', 'twilio_auth_token', 'twilio_phone_number',
  'orange_cm_client_id', 'orange_cm_client_secret', 'orange_cm_sender_address',
  'at_api_key', 'at_username', 'at_sender_id',
  'sendgrid_api_key', 'sendgrid_from_email',
  // Credentials paiement (gérées via PUT /payment-providers)
  'payment_cinetpay_api_key', 'payment_cinetpay_site_id',
  'payment_flutterwave_secret_key', 'payment_flutterwave_webhook_hash',
  'payment_stripe_secret_key', 'payment_stripe_webhook_secret',
  'payment_notchpay_public_key', 'payment_notchpay_private_key', 'payment_notchpay_webhook_secret',
  'payment_mpesa_consumer_key', 'payment_mpesa_consumer_secret', 'payment_mpesa_shortcode', 'payment_mpesa_passkey',
  'payment_paypal_client_id', 'payment_paypal_client_secret', 'payment_paypal_webhook_id',
  'payment_wave_api_key', 'payment_wave_webhook_secret',
  // Toggles providers (gérés via PUT /payment-providers)
  'payment_cinetpay_enabled', 'payment_flutterwave_enabled', 'payment_stripe_enabled',
  'payment_notchpay_enabled', 'payment_mpesa_enabled', 'payment_paypal_enabled', 'payment_wave_enabled',
  // Sécurité paiements + config système (gérés via PATCH /payment-security)
  'payment_max_recharge_amount',
  'withdrawal_min_amount', 'withdrawal_max_amount', 'withdrawal_max_daily_amount', 'withdrawal_carence_hours',
  'backend_url',
];

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

@SkipThrottle()
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
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

  // ── Credentials SMS/Email ─────────────────────────────────────────────────

  /** GET /admin/settings/credentials — retourne statut (configuré ou non) sans exposer les valeurs */
  @Get('credentials')
  async getCredentials() {
    const keys = [
      'twilio_account_sid', 'twilio_auth_token', 'twilio_phone_number',
      'orange_cm_client_id', 'orange_cm_client_secret', 'orange_cm_sender_address',
      'at_api_key', 'at_username', 'at_sender_id',
      'sendgrid_api_key', 'sendgrid_from_email',
    ];
    const values = await Promise.all(keys.map((k) => this.settings.get(k)));
    const status: Record<string, boolean> = {};
    keys.forEach((k, i) => { status[k] = !!values[i]; });
    return { status };
  }

  /** PUT /admin/settings/credentials — met à jour un ou plusieurs credentials */
  @Put('credentials')
  async setCredentials(
    @Body() body: Record<string, string>,
    @CurrentUser() admin: any,
  ) {
    const allowed = [
      'twilio_account_sid', 'twilio_auth_token', 'twilio_phone_number',
      'orange_cm_client_id', 'orange_cm_client_secret', 'orange_cm_sender_address',
      'at_api_key', 'at_username', 'at_sender_id',
      'sendgrid_api_key', 'sendgrid_from_email',
    ];
    const updates: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.includes(key)) continue;
      if (typeof value !== 'string') continue;
      await this.settings.set(key, value.trim());
      updates.push(key);
    }
    this.audit.log({
      action: 'UPDATE_CREDENTIALS',
      entity: 'AppSetting',
      adminId: admin.id,
      meta: { updatedKeys: updates },
    }).catch(() => {});
    return { success: true, updated: updates };
  }

  // ── Google Maps Key ───────────────────────────────────────────────────────

  @Get('maps-key')
  async getMapsKey() {
    const key = await this.settings.get('google_maps_key', '');
    // Masquer partiellement la clé dans la réponse (sécurité)
    const masked = key ? key.slice(0, 8) + '••••••••••••••••••••' + key.slice(-4) : '';
    return { configured: !!key, maskedKey: masked };
  }

  @Put('maps-key')
  async setMapsKey(@Body() body: { key: string }, @CurrentUser() admin: any) {
    if (!body.key || !body.key.startsWith('AIzaSy')) {
      throw new ForbiddenException('Clé Google Maps invalide (doit commencer par AIzaSy)');
    }
    await this.settings.set('google_maps_key', body.key.trim());
    this.audit.log({
      action: 'UPDATE_MAPS_KEY',
      entity: 'AppSetting',
      adminId: admin.id,
      meta: { keyPrefix: body.key.slice(0, 8) },
    }).catch(() => {});
    return { success: true };
  }

  // ── Test Mode ─────────────────────────────────────────────────────────────

  /**
   * GET /admin/settings/test-mode
   * Retourne la config complète du mode test/prod en un seul appel.
   */
  @Get('test-mode')
  async getTestMode() {
    const [enabled, otpValue, otpLog, channel, smsRaw, emailProvider] = await Promise.all([
      this.settings.get('test_mode_enabled', 'false'),
      this.settings.get('test_otp_value', '000000'),
      this.settings.get('otp_log_enabled', 'false'),
      this.settings.get('otp_channel', 'sms'),
      this.settings.get('sms_routing_rules', '{}'),
      this.settings.get('email_provider', 'mock'),
    ]);
    let smsRouting: Record<string, string> = { default: 'mock' };
    try { smsRouting = JSON.parse(smsRaw); } catch { /* keep default */ }

    return {
      testModeEnabled: enabled === 'true',
      testOtpValue: otpValue,
      otpLogEnabled: otpLog === 'true',
      otpChannel: channel,
      smsDefaultProvider: smsRouting['default'] ?? 'mock',
      emailProvider,
      availableSmsProviders: SMS_PROVIDERS,
      availableEmailProviders: ['mock', 'sendgrid', 'smtp'],
      availableOtpChannels: ['sms', 'email', 'both'],
    };
  }

  /**
   * PUT /admin/settings/test-mode
   * Met à jour toutes les clés de mode test/prod atomiquement.
   */
  @Put('test-mode')
  async setTestMode(
    @Body() body: {
      testModeEnabled: boolean;
      testOtpValue?: string;
      otpLogEnabled?: boolean;
      otpChannel?: string;
      smsDefaultProvider?: string;
      emailProvider?: string;
    },
    @CurrentUser() admin: any,
  ) {
    const allowedSms = [...SMS_PROVIDERS];
    const allowedEmail = ['mock', 'sendgrid', 'smtp'];
    const allowedChannels = ['sms', 'email', 'both'];

    const updates: Array<[string, string]> = [
      ['test_mode_enabled', String(body.testModeEnabled)],
    ];
    if (body.testOtpValue !== undefined) {
      if (!/^\d{4,8}$/.test(body.testOtpValue)) {
        throw new ForbiddenException('Le code OTP de test doit contenir entre 4 et 8 chiffres.');
      }
      updates.push(['test_otp_value', body.testOtpValue]);
    }
    if (body.otpLogEnabled !== undefined) {
      updates.push(['otp_log_enabled', String(body.otpLogEnabled)]);
    }
    if (body.otpChannel !== undefined) {
      if (!allowedChannels.includes(body.otpChannel)) {
        throw new ForbiddenException(`Canal OTP invalide. Valeurs: ${allowedChannels.join(', ')}`);
      }
      updates.push(['otp_channel', body.otpChannel]);
    }
    if (body.smsDefaultProvider !== undefined) {
      if (!allowedSms.includes(body.smsDefaultProvider as any)) {
        throw new ForbiddenException(`Provider SMS invalide. Valeurs: ${allowedSms.join(', ')}`);
      }
      // Mise à jour du provider par défaut dans sms_routing_rules
      const rawRules = await this.settings.get('sms_routing_rules', '{}');
      let rules: Record<string, string> = {};
      try { rules = JSON.parse(rawRules); } catch { /* ok */ }
      rules['default'] = body.smsDefaultProvider;
      updates.push(['sms_routing_rules', JSON.stringify(rules)]);
    }
    if (body.emailProvider !== undefined) {
      if (!allowedEmail.includes(body.emailProvider)) {
        throw new ForbiddenException(`Provider email invalide. Valeurs: ${allowedEmail.join(', ')}`);
      }
      updates.push(['email_provider', body.emailProvider]);
    }

    await Promise.all(updates.map(([key, value]) => this.settings.set(key, value)));

    this.audit.log({
      action: body.testModeEnabled ? 'ENABLE_TEST_MODE' : 'DISABLE_TEST_MODE',
      entity: 'AppSetting',
      adminId: admin.id,
      meta: body,
    }).catch(() => {});

    return { success: true, updates: Object.fromEntries(updates) };
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

  // ── Sécurité paiements ───────────────────────────────────────────────────────

  /**
   * PATCH /admin/settings/payment-security
   * Plafonds recharge, limites et délai carence retrait — permission dédiée.
   */
  @Patch('payment-security')
  @RequirePermission('manage_payment_security')
  async setPaymentSecurity(
    @Body() body: Record<string, string>,
    @CurrentUser() admin: any,
  ) {
    const NUMERIC_KEYS = new Set([
      'payment_max_recharge_amount',
      'withdrawal_min_amount',
      'withdrawal_max_amount',
      'withdrawal_max_daily_amount',
      'withdrawal_carence_hours',
    ]);
    const STRING_KEYS = new Set(['backend_url']);
    const updated: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (STRING_KEYS.has(key)) {
        const url = String(value).trim();
        if (!url.startsWith('http')) continue;
        await this.settings.set(key, url);
        updated.push(key);
      } else if (NUMERIC_KEYS.has(key)) {
        const num = parseInt(String(value), 10);
        if (isNaN(num) || num < 0) continue;
        await this.settings.set(key, String(num));
        updated.push(key);
      }
    }
    this.audit.log({
      action: 'UPDATE_PAYMENT_SECURITY',
      entity: 'AppSetting',
      adminId: admin.id,
      meta: { updatedKeys: updated },
    }).catch(() => {});
    return { success: true, updated };
  }

  // ── Payment providers credentials ─────────────────────────────────────────

  static readonly PAYMENT_PROVIDERS = [
    'cinetpay', 'flutterwave', 'stripe', 'notchpay', 'mpesa', 'paypal', 'wave',
  ] as const;

  /** Clés DB → sensibles masquées, les autres indiquent juste si configurées */
  private static readonly PAYMENT_KEYS: { key: string; label: string; sensitive: boolean }[] = [
    { key: 'payment_cinetpay_api_key',           label: 'CinetPay API Key',             sensitive: true  },
    { key: 'payment_cinetpay_site_id',            label: 'CinetPay Site ID',             sensitive: false },
    { key: 'payment_flutterwave_secret_key',      label: 'Flutterwave Secret Key',       sensitive: true  },
    { key: 'payment_flutterwave_webhook_hash',    label: 'Flutterwave Webhook Hash',     sensitive: true  },
    { key: 'payment_stripe_secret_key',           label: 'Stripe Secret Key',            sensitive: true  },
    { key: 'payment_stripe_webhook_secret',       label: 'Stripe Webhook Secret',        sensitive: true  },
    { key: 'payment_notchpay_public_key',         label: 'NotchPay Public Key',          sensitive: true  },
    { key: 'payment_notchpay_private_key',        label: 'NotchPay Private Key',         sensitive: true  },
    { key: 'payment_notchpay_webhook_secret',     label: 'NotchPay Webhook Secret',      sensitive: true  },
    { key: 'payment_mpesa_consumer_key',          label: 'M-Pesa Consumer Key',          sensitive: true  },
    { key: 'payment_mpesa_consumer_secret',       label: 'M-Pesa Consumer Secret',       sensitive: true  },
    { key: 'payment_mpesa_shortcode',             label: 'M-Pesa Shortcode',             sensitive: false },
    { key: 'payment_mpesa_passkey',               label: 'M-Pesa Passkey',               sensitive: true  },
    { key: 'payment_paypal_client_id',            label: 'PayPal Client ID',             sensitive: false },
    { key: 'payment_paypal_client_secret',        label: 'PayPal Client Secret',         sensitive: true  },
    { key: 'payment_paypal_webhook_id',           label: 'PayPal Webhook ID',            sensitive: false },
    { key: 'payment_wave_api_key',                label: 'Wave API Key',                 sensitive: true  },
    { key: 'payment_wave_webhook_secret',         label: 'Wave Webhook Secret',          sensitive: true  },
  ];

  /**
   * GET /admin/settings/payment-providers
   * Retourne pour chaque provider : enabled (toggle), credentials masquées.
   */
  @Get('payment-providers')
  @RequirePermission('view_payment_providers')
  async getPaymentProviders() {
    const providers = SettingsController.PAYMENT_PROVIDERS;

    // Lire enabled flags + credentials en parallèle
    const [enabledValues, credValues] = await Promise.all([
      Promise.all(providers.map((p) => this.settings.get(`payment_${p}_enabled`, 'true'))),
      Promise.all(
        SettingsController.PAYMENT_KEYS.map(({ key }) => this.settings.get(key, '')),
      ),
    ]);

    const enabled: Record<string, boolean> = {};
    providers.forEach((p, i) => { enabled[p] = enabledValues[i] !== 'false'; });

    const credentials: Record<string, { label: string; configured: boolean; maskedValue?: string }> = {};
    SettingsController.PAYMENT_KEYS.forEach(({ key, label, sensitive }, i) => {
      const value = credValues[i];
      credentials[key] = {
        label,
        configured: !!value,
        maskedValue: value && sensitive
          ? `${value.slice(0, 4)}${'•'.repeat(12)}${value.slice(-4)}`
          : value || undefined,
      };
    });

    return { enabled, credentials };
  }

  /**
   * PUT /admin/settings/payment-providers
   * Body: {
   *   enabled?: { cinetpay: true, stripe: false, ... },
   *   credentials?: { payment_stripe_secret_key: "sk_live_...", ... }
   * }
   */
  @Put('payment-providers')
  @RequirePermission('manage_payment_providers')
  async setPaymentProviders(
    @Body() body: { enabled?: Record<string, boolean>; credentials?: Record<string, string> },
    @CurrentUser() admin: any,
  ) {
    const updated: string[] = [];

    // Mise à jour des toggles enabled
    if (body.enabled) {
      const validProviders = new Set(SettingsController.PAYMENT_PROVIDERS as readonly string[]);
      for (const [provider, value] of Object.entries(body.enabled)) {
        if (!validProviders.has(provider)) continue;
        await this.settings.set(`payment_${provider}_enabled`, String(!!value));
        updated.push(`payment_${provider}_enabled`);
      }
    }

    // Mise à jour des credentials
    if (body.credentials) {
      const allowed = new Set(SettingsController.PAYMENT_KEYS.map((k) => k.key));
      for (const [key, value] of Object.entries(body.credentials)) {
        if (!allowed.has(key) || typeof value !== 'string') continue;
        await this.settings.set(key, value.trim());
        updated.push(key);
      }
    }

    this.audit.log({
      action:  'UPDATE_PAYMENT_PROVIDERS',
      entity:  'AppSetting',
      adminId: admin.id,
      meta:    { updatedKeys: updated },
    }).catch(() => {});

    return { success: true, updated };
  }
}
