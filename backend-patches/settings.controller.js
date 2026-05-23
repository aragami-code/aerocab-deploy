"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SettingsController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const settings_service_1 = require("./settings.service");
const audit_service_1 = require("../audit/audit.service");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const decorators_2 = require("../auth/decorators");
const permissions_guard_1 = require("../rbac/permissions.guard");
const require_permission_decorator_1 = require("../rbac/require-permission.decorator");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
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
const SMS_PROVIDERS = ['mock', 'twilio', 'orange-cm', 'africas-talking'];
class SmsRoutingRuleDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\+\d{1,4}$/, { message: 'Le préfixe doit être au format E.164 : +237, +221, etc.' }),
    __metadata("design:type", String)
], SmsRoutingRuleDto.prototype, "prefix", void 0);
__decorate([
    (0, class_validator_1.IsIn)(SMS_PROVIDERS),
    __metadata("design:type", String)
], SmsRoutingRuleDto.prototype, "provider", void 0);
class SetSmsRoutingDto {
}
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => SmsRoutingRuleDto),
    __metadata("design:type", Array)
], SetSmsRoutingDto.prototype, "rules", void 0);
__decorate([
    (0, class_validator_1.IsIn)(SMS_PROVIDERS),
    __metadata("design:type", String)
], SetSmsRoutingDto.prototype, "defaultProvider", void 0);
class SetProximityDto {
}
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], SetProximityDto.prototype, "enabled", void 0);
class SetAppSettingDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], SetAppSettingDto.prototype, "key", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SetAppSettingDto.prototype, "value", void 0);
let SettingsController = SettingsController_1 = class SettingsController {
    constructor(settings, audit) {
        this.settings = settings;
        this.audit = audit;
    }
    getAll() {
        return this.settings.getAll();
    }
    async setKey(dto) {
        // TODO Phase 6 : vérifier permission granulaire via @RequirePermission()
        // Pour l'instant : les clés sensibles nécessitent un rôle admin (déjà garanti par @Roles)
        // Cette liste bloque l'édition directe des clés sensibles — utiliser les endpoints dédiés
        if (DEDICATED_ENDPOINT_KEYS.includes(dto.key)) {
            throw new common_1.ForbiddenException(`La clé '${dto.key}' est gérée par un endpoint dédié. Utilisez /admin/settings/sms-routing ou /admin/settings/email-provider.`);
        }
        await this.settings.set(dto.key, dto.value);
        return { key: dto.key, value: dto.value };
    }
    // ── SMS Routing ────────────────────────────────────────────────────────────
    /**
     * GET /admin/settings/sms-routing
     * TODO Phase 6 : @RequirePermission('manage_sms_providers') — super_admin uniquement
     */
    async getSmsRouting() {
        var _a;
        const raw = await this.settings.get('sms_routing_rules');
        let parsed = { default: 'mock' };
        if (raw) {
            try {
                parsed = JSON.parse(raw);
            }
            catch ( /* keep default */_b) { /* keep default */ }
        }
        const rules = Object.entries(parsed)
            .filter(([k]) => k !== 'default')
            .map(([prefix, provider]) => ({ prefix, provider }));
        return {
            rules,
            defaultProvider: (_a = parsed['default']) !== null && _a !== void 0 ? _a : 'mock',
            availableProviders: SMS_PROVIDERS,
        };
    }
    /**
     * PUT /admin/settings/sms-routing
     * TODO Phase 6 : @RequirePermission('manage_sms_providers') — super_admin uniquement
     */
    async setSmsRouting(dto, admin) {
        const rulesObj = { default: dto.defaultProvider };
        for (const rule of dto.rules) {
            rulesObj[rule.prefix] = rule.provider;
        }
        await this.settings.set('sms_routing_rules', JSON.stringify(rulesObj));
        this.audit.log({
            action: 'UPDATE_SMS_ROUTING',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: { rules: dto.rules, defaultProvider: dto.defaultProvider },
        }).catch(() => { });
        return { rules: dto.rules, defaultProvider: dto.defaultProvider };
    }
    // ── Email provider ─────────────────────────────────────────────────────────
    /**
     * GET /admin/settings/email-provider
     * TODO Phase 6 : @RequirePermission('manage_email_providers') — super_admin uniquement
     */
    async getEmailProvider() {
        var _a;
        const provider = (_a = await this.settings.get('email_provider')) !== null && _a !== void 0 ? _a : 'mock';
        return { provider, availableProviders: ['mock', 'sendgrid', 'smtp'] };
    }
    /**
     * PUT /admin/settings/email-provider
     * TODO Phase 6 : @RequirePermission('manage_email_providers') — super_admin uniquement
     */
    async setEmailProvider(body, admin) {
        const allowed = ['mock', 'sendgrid', 'smtp'];
        if (!allowed.includes(body.provider)) {
            throw new common_1.ForbiddenException(`Provider invalide. Valeurs acceptées : ${allowed.join(', ')}`);
        }
        await this.settings.set('email_provider', body.provider);
        this.audit.log({
            action: 'UPDATE_EMAIL_PROVIDER',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: { provider: body.provider },
        }).catch(() => { });
        return { provider: body.provider };
    }
    // ── Credentials SMS/Email ─────────────────────────────────────────────────
    /** GET /admin/settings/credentials — retourne statut (configuré ou non) sans exposer les valeurs */
    async getCredentials() {
        const keys = [
            'twilio_account_sid', 'twilio_auth_token', 'twilio_phone_number',
            'orange_cm_client_id', 'orange_cm_client_secret', 'orange_cm_sender_address',
            'at_api_key', 'at_username', 'at_sender_id',
            'sendgrid_api_key', 'sendgrid_from_email',
        ];
        const values = await Promise.all(keys.map((k) => this.settings.get(k)));
        const status = {};
        keys.forEach((k, i) => { status[k] = !!values[i]; });
        return { status };
    }
    /** PUT /admin/settings/credentials — met à jour un ou plusieurs credentials */
    async setCredentials(body, admin) {
        const allowed = [
            'twilio_account_sid', 'twilio_auth_token', 'twilio_phone_number',
            'orange_cm_client_id', 'orange_cm_client_secret', 'orange_cm_sender_address',
            'at_api_key', 'at_username', 'at_sender_id',
            'sendgrid_api_key', 'sendgrid_from_email',
            'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from_email',
        ];
        const updates = [];
        for (const [key, value] of Object.entries(body)) {
            if (!allowed.includes(key))
                continue;
            if (typeof value !== 'string')
                continue;
            await this.settings.set(key, value.trim());
            updates.push(key);
        }
        this.audit.log({
            action: 'UPDATE_CREDENTIALS',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: { updatedKeys: updates },
        }).catch(() => { });
        return { success: true, updated: updates };
    }
    // ── Google Maps Key ───────────────────────────────────────────────────────
    async getMapsKey() {
        const key = await this.settings.get('google_maps_key', '');
        // Masquer partiellement la clé dans la réponse (sécurité)
        const masked = key ? key.slice(0, 8) + '••••••••••••••••••••' + key.slice(-4) : '';
        return { configured: !!key, maskedKey: masked };
    }
    async setMapsKey(body, admin) {
        if (!body.key || !body.key.startsWith('AIzaSy')) {
            throw new common_1.ForbiddenException('Clé Google Maps invalide (doit commencer par AIzaSy)');
        }
        await this.settings.set('google_maps_key', body.key.trim());
        this.audit.log({
            action: 'UPDATE_MAPS_KEY',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: { keyPrefix: body.key.slice(0, 8) },
        }).catch(() => { });
        return { success: true };
    }
    // ── Test Mode ─────────────────────────────────────────────────────────────
    /**
     * GET /admin/settings/test-mode
     * Retourne la config complète du mode test/prod en un seul appel.
     */
    async getTestMode() {
        var _a;
        const [enabled, otpValue, otpLog, channel, smsRaw, emailProvider] = await Promise.all([
            this.settings.get('test_mode_enabled', 'false'),
            this.settings.get('test_otp_value', '000000'),
            this.settings.get('otp_log_enabled', 'false'),
            this.settings.get('otp_channel', 'sms'),
            this.settings.get('sms_routing_rules', '{}'),
            this.settings.get('email_provider', 'mock'),
        ]);
        let smsRouting = { default: 'mock' };
        try {
            smsRouting = JSON.parse(smsRaw);
        }
        catch ( /* keep default */_b) { /* keep default */ }
        return {
            testModeEnabled: enabled === 'true',
            testOtpValue: otpValue,
            otpLogEnabled: otpLog === 'true',
            otpChannel: channel,
            smsDefaultProvider: (_a = smsRouting['default']) !== null && _a !== void 0 ? _a : 'mock',
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
    async setTestMode(body, admin) {
        const allowedSms = [...SMS_PROVIDERS];
        const allowedEmail = ['mock', 'sendgrid', 'smtp'];
        const allowedChannels = ['sms', 'email', 'both'];
        const updates = [
            ['test_mode_enabled', String(body.testModeEnabled)],
        ];
        if (body.testOtpValue !== undefined) {
            if (!/^\d{4,8}$/.test(body.testOtpValue)) {
                throw new common_1.ForbiddenException('Le code OTP de test doit contenir entre 4 et 8 chiffres.');
            }
            updates.push(['test_otp_value', body.testOtpValue]);
        }
        if (body.otpLogEnabled !== undefined) {
            updates.push(['otp_log_enabled', String(body.otpLogEnabled)]);
        }
        if (body.otpChannel !== undefined) {
            if (!allowedChannels.includes(body.otpChannel)) {
                throw new common_1.ForbiddenException(`Canal OTP invalide. Valeurs: ${allowedChannels.join(', ')}`);
            }
            updates.push(['otp_channel', body.otpChannel]);
        }
        if (body.smsDefaultProvider !== undefined) {
            if (!allowedSms.includes(body.smsDefaultProvider)) {
                throw new common_1.ForbiddenException(`Provider SMS invalide. Valeurs: ${allowedSms.join(', ')}`);
            }
            // Mise à jour du provider par défaut dans sms_routing_rules
            const rawRules = await this.settings.get('sms_routing_rules', '{}');
            let rules = {};
            try {
                rules = JSON.parse(rawRules);
            }
            catch ( /* ok */_a) { /* ok */ }
            rules['default'] = body.smsDefaultProvider;
            updates.push(['sms_routing_rules', JSON.stringify(rules)]);
        }
        if (body.emailProvider !== undefined) {
            if (!allowedEmail.includes(body.emailProvider)) {
                throw new common_1.ForbiddenException(`Provider email invalide. Valeurs: ${allowedEmail.join(', ')}`);
            }
            updates.push(['email_provider', body.emailProvider]);
        }
        await Promise.all(updates.map(([key, value]) => this.settings.set(key, value)));
        this.audit.log({
            action: body.testModeEnabled ? 'ENABLE_TEST_MODE' : 'DISABLE_TEST_MODE',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: body,
        }).catch(() => { });
        return { success: true, updates: Object.fromEntries(updates) };
    }
    // ── Proximity assignment ───────────────────────────────────────────────────
    async getProximity() {
        const enabled = await this.settings.isProximityAssignmentEnabled();
        return { proximityAssignment: enabled };
    }
    async setProximity(dto) {
        await this.settings.setProximityAssignment(dto.enabled);
        return { proximityAssignment: dto.enabled };
    }
    // ── Sécurité paiements ───────────────────────────────────────────────────────
    /**
     * PATCH /admin/settings/payment-security
     * Plafonds recharge, limites et délai carence retrait — permission dédiée.
     */
    async setPaymentSecurity(body, admin) {
        const NUMERIC_KEYS = new Set([
            'payment_max_recharge_amount',
            'withdrawal_min_amount',
            'withdrawal_max_amount',
            'withdrawal_max_daily_amount',
            'withdrawal_carence_hours',
        ]);
        const STRING_KEYS = new Set(['backend_url']);
        const updated = [];
        for (const [key, value] of Object.entries(body)) {
            if (STRING_KEYS.has(key)) {
                const url = String(value).trim();
                if (!url.startsWith('http'))
                    continue;
                await this.settings.set(key, url);
                updated.push(key);
            }
            else if (NUMERIC_KEYS.has(key)) {
                const num = parseInt(String(value), 10);
                if (isNaN(num) || num < 0)
                    continue;
                await this.settings.set(key, String(num));
                updated.push(key);
            }
        }
        this.audit.log({
            action: 'UPDATE_PAYMENT_SECURITY',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: { updatedKeys: updated },
        }).catch(() => { });
        return { success: true, updated };
    }
    /**
     * GET /admin/settings/payment-providers
     * Retourne pour chaque provider : enabled (toggle), credentials masquées.
     */
    async getPaymentProviders() {
        const providers = SettingsController_1.PAYMENT_PROVIDERS;
        // Lire enabled flags + credentials en parallèle
        const [enabledValues, credValues] = await Promise.all([
            Promise.all(providers.map((p) => this.settings.get(`payment_${p}_enabled`, 'true'))),
            Promise.all(SettingsController_1.PAYMENT_KEYS.map(({ key }) => this.settings.get(key, ''))),
        ]);
        const enabled = {};
        providers.forEach((p, i) => { enabled[p] = enabledValues[i] !== 'false'; });
        const credentials = {};
        SettingsController_1.PAYMENT_KEYS.forEach(({ key, label, sensitive }, i) => {
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
    async setPaymentProviders(body, admin) {
        const updated = [];
        // Mise à jour des toggles enabled
        if (body.enabled) {
            const validProviders = new Set(SettingsController_1.PAYMENT_PROVIDERS);
            for (const [provider, value] of Object.entries(body.enabled)) {
                if (!validProviders.has(provider))
                    continue;
                await this.settings.set(`payment_${provider}_enabled`, String(!!value));
                updated.push(`payment_${provider}_enabled`);
            }
        }
        // Mise à jour des credentials
        if (body.credentials) {
            const allowed = new Set(SettingsController_1.PAYMENT_KEYS.map((k) => k.key));
            for (const [key, value] of Object.entries(body.credentials)) {
                if (!allowed.has(key) || typeof value !== 'string')
                    continue;
                await this.settings.set(key, value.trim());
                updated.push(key);
            }
        }
        this.audit.log({
            action: 'UPDATE_PAYMENT_PROVIDERS',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: { updatedKeys: updated },
        }).catch(() => { });
        return { success: true, updated };
    }
    // ── Forfaits de recharge de points ───────────────────────────────────────────
    async getPointsPackages() {
        const raw = await this.settings.get('points_recharge_packages', '[1000,3000,5000,10000]');
        let sizes;
        try {
            sizes = JSON.parse(raw);
        }
        catch (_a) {
            sizes = [1000, 3000, 5000, 10000];
        }
        return { packages: sizes };
    }
    async setPointsPackages(body, admin) {
        if (!Array.isArray(body.packages))
            throw new common_1.BadRequestException('packages doit être un tableau de nombres');
        const sizes = body.packages
            .map(n => parseInt(String(n), 10))
            .filter(n => !isNaN(n) && n > 0 && n <= 1000000);
        if (sizes.length === 0)
            throw new common_1.BadRequestException('Au moins un forfait requis');
        await this.settings.set('points_recharge_packages', JSON.stringify(sizes));
        this.audit.log({
            action: 'UPDATE_POINTS_PACKAGES',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: { packages: sizes },
        }).catch(() => { });
        return { success: true, packages: sizes };
    }
    async getDriverDocumentConfig() {
        const raw = await this.settings.get('driver_document_config', '');
        if (raw) {
            try {
                return { documents: JSON.parse(raw) };
            }
            catch ( /* fallback */_a) { /* fallback */ }
        }
        return { documents: SettingsController_1.DEFAULT_DOCUMENT_CONFIG };
    }
    async setDriverDocumentConfig(body, admin) {
        if (!Array.isArray(body.documents))
            throw new common_1.BadRequestException('documents doit être un tableau');
        const allowed = new Set(SettingsController_1.ALL_DOCUMENT_TYPES);
        const VALID_EXT = new Set(['jpg', 'png', 'pdf', 'heic', 'webp']);
        const validated = body.documents
            .filter(d => allowed.has(d.type))
            .map(d => {
            var _a, _b;
            return ({
                type: d.type,
                label: ((_a = d.label) === null || _a === void 0 ? void 0 : _a.trim()) || d.type,
                description: ((_b = d.description) === null || _b === void 0 ? void 0 : _b.trim()) || '',
                required: !!d.required,
                enabled: !!d.enabled,
                acceptedExtensions: Array.isArray(d.acceptedExtensions)
                    ? d.acceptedExtensions.filter(e => VALID_EXT.has(e))
                    : ['jpg', 'png', 'pdf'],
            });
        });
        if (validated.length === 0)
            throw new common_1.BadRequestException('Aucun document valide');
        await this.settings.set('driver_document_config', JSON.stringify(validated));
        this.audit.log({
            action: 'UPDATE_DRIVER_DOCUMENT_CONFIG',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: { count: validated.length },
        }).catch(() => { });
        return { success: true, documents: validated };
    }
    async getAllDocumentTypes() {
        return {
            types: SettingsController_1.ALL_DOCUMENT_TYPES,
            defaults: SettingsController_1.DEFAULT_DOCUMENT_CONFIG,
        };
    }
    async getBotSettings() {
        const [enabled, provider, model, rawMaxTokens, systemPrompt, claudeKey, openaiKey, zhipuKey, geminiKey] = await Promise.all([
            this.settings.get('bot_enabled', 'false'),
            this.settings.get('bot_provider', 'claude'),
            this.settings.get('bot_model', 'claude-haiku-4-5-20251001'),
            this.settings.get('bot_max_tokens', '500'),
            this.settings.get('bot_system_prompt', ''),
            this.settings.get('bot_claude_api_key', ''),
            this.settings.get('bot_openai_api_key', ''),
            this.settings.get('bot_zhipu_api_key', ''),
            this.settings.get('bot_gemini_api_key', ''),
        ]);
        const mask = (k) => k ? k.slice(0, 6) + '••••••••••••' + k.slice(-4) : '';
        return {
            enabled: enabled === 'true',
            provider,
            model,
            maxTokens: parseInt(rawMaxTokens, 10) || 500,
            systemPrompt,
            providers: SettingsController_1.BOT_PROVIDERS,
            claudeKey:  { configured: !!claudeKey,  masked: mask(claudeKey)  },
            openaiKey:  { configured: !!openaiKey,  masked: mask(openaiKey)  },
            zhipuKey:   { configured: !!zhipuKey,   masked: mask(zhipuKey)   },
            geminiKey:  { configured: !!geminiKey,  masked: mask(geminiKey)  },
        };
    }
    async setBotSettings(body, admin) {
        var _a, _b, _c, _d;
        const ops = [];
        if (body.enabled !== undefined)
            ops.push(this.settings.set('bot_enabled', String(!!body.enabled)));
        if (body.provider !== undefined) {
            if (!SettingsController_1.BOT_PROVIDERS.includes(body.provider))
                throw new common_1.BadRequestException(`Provider inconnu. Valeurs acceptées : ${SettingsController_1.BOT_PROVIDERS.join(', ')}`);
            ops.push(this.settings.set('bot_provider', body.provider));
        }
        if ((_a = body.model) === null || _a === void 0 ? void 0 : _a.trim())
            ops.push(this.settings.set('bot_model', body.model.trim()));
        if (body.maxTokens !== undefined) {
            const t = parseInt(String(body.maxTokens), 10);
            if (isNaN(t) || t < 50 || t > 4096)
                throw new common_1.BadRequestException('maxTokens doit être entre 50 et 4096');
            ops.push(this.settings.set('bot_max_tokens', String(t)));
        }
        if (body.systemPrompt !== undefined)
            ops.push(this.settings.set('bot_system_prompt', body.systemPrompt));
        if ((_b = body.claudeApiKey) === null || _b === void 0 ? void 0 : _b.trim())
            ops.push(this.settings.set('bot_claude_api_key', body.claudeApiKey.trim()));
        if ((_c = body.openaiApiKey) === null || _c === void 0 ? void 0 : _c.trim())
            ops.push(this.settings.set('bot_openai_api_key', body.openaiApiKey.trim()));
        if ((_d = body.zhipuApiKey) === null || _d === void 0 ? void 0 : _d.trim())
            ops.push(this.settings.set('bot_zhipu_api_key', body.zhipuApiKey.trim()));
        if (body.geminiApiKey && body.geminiApiKey.trim())
            ops.push(this.settings.set('bot_gemini_api_key', body.geminiApiKey.trim()));
        await Promise.all(ops);
        this.audit.log({
            action: 'UPDATE_BOT_SETTINGS',
            entity: 'AppSetting',
            adminId: admin.id,
            meta: { provider: body.provider, enabled: body.enabled },
        }).catch(() => { });
        return { success: true };
    }
};
exports.SettingsController = SettingsController;
// ── Payment providers credentials ─────────────────────────────────────────
SettingsController.PAYMENT_PROVIDERS = [
    'cinetpay', 'flutterwave', 'stripe', 'notchpay', 'mpesa', 'paypal', 'wave',
];
/** Clés DB → sensibles masquées, les autres indiquent juste si configurées */
SettingsController.PAYMENT_KEYS = [
    { key: 'payment_cinetpay_api_key', label: 'CinetPay API Key', sensitive: true },
    { key: 'payment_cinetpay_site_id', label: 'CinetPay Site ID', sensitive: false },
    { key: 'payment_flutterwave_secret_key', label: 'Flutterwave Secret Key', sensitive: true },
    { key: 'payment_flutterwave_webhook_hash', label: 'Flutterwave Webhook Hash', sensitive: true },
    { key: 'payment_stripe_secret_key', label: 'Stripe Secret Key', sensitive: true },
    { key: 'payment_stripe_webhook_secret', label: 'Stripe Webhook Secret', sensitive: true },
    { key: 'payment_notchpay_public_key', label: 'NotchPay Public Key', sensitive: true },
    { key: 'payment_notchpay_private_key', label: 'NotchPay Private Key', sensitive: true },
    { key: 'payment_notchpay_webhook_secret', label: 'NotchPay Webhook Secret', sensitive: true },
    { key: 'payment_mpesa_consumer_key', label: 'M-Pesa Consumer Key', sensitive: true },
    { key: 'payment_mpesa_consumer_secret', label: 'M-Pesa Consumer Secret', sensitive: true },
    { key: 'payment_mpesa_shortcode', label: 'M-Pesa Shortcode', sensitive: false },
    { key: 'payment_mpesa_passkey', label: 'M-Pesa Passkey', sensitive: true },
    { key: 'payment_paypal_client_id', label: 'PayPal Client ID', sensitive: false },
    { key: 'payment_paypal_client_secret', label: 'PayPal Client Secret', sensitive: true },
    { key: 'payment_paypal_webhook_id', label: 'PayPal Webhook ID', sensitive: false },
    { key: 'payment_wave_api_key', label: 'Wave API Key', sensitive: true },
    { key: 'payment_wave_webhook_secret', label: 'Wave Webhook Secret', sensitive: true },
];
// ── Configuration documents chauffeur ─────────────────────────────────────────
SettingsController.ALL_DOCUMENT_TYPES = [
    'cni_front', 'cni_back', 'license', 'registration', 'vehicle_photo',
    'insurance', 'technical_control', 'vtc_license', 'passport', 'portrait',
    'criminal_record', 'proof_of_address', 'medical_certificate',
    'vaccination_card', 'border_pass', 'selfie',
];
SettingsController.DEFAULT_DOCUMENT_CONFIG = [
    { type: 'cni_front', label: 'CNI — Recto', description: 'Face avant de votre carte nationale', required: true, enabled: true, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'cni_back', label: 'CNI — Verso', description: "Face arrière de votre carte nationale", required: true, enabled: true, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'license', label: 'Permis de conduire', description: 'Permis en cours de validité', required: true, enabled: true, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'registration', label: 'Carte grise', description: "Document d'immatriculation du véhicule", required: true, enabled: true, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'vehicle_photo', label: 'Photo du véhicule', description: 'Vue de face du véhicule', required: true, enabled: true, acceptedExtensions: ['jpg', 'png'] },
    { type: 'insurance', label: "Attestation d'assurance", description: 'Attestation couvrant le transport de personnes', required: false, enabled: false, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'technical_control', label: 'Visite technique', description: 'Contrôle technique en cours de validité', required: false, enabled: false, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'vtc_license', label: 'Autorisation VTC', description: 'Autorisation officielle de transport VTC', required: false, enabled: false, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'passport', label: 'Passeport', description: 'Passeport en cours de validité', required: false, enabled: false, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'portrait', label: 'Photo portrait', description: 'Selfie face caméra, fond neutre', required: false, enabled: false, acceptedExtensions: ['jpg', 'png'] },
    { type: 'criminal_record', label: 'Casier judiciaire', description: 'Bulletin n°3 daté de moins de 3 mois', required: false, enabled: false, acceptedExtensions: ['pdf'] },
    { type: 'proof_of_address', label: 'Justificatif de domicile', description: 'Facture ou relevé de moins de 3 mois', required: false, enabled: false, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'medical_certificate', label: 'Certificat médical', description: "Attestation d'aptitude à la conduite", required: false, enabled: false, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'vaccination_card', label: 'Carte de vaccination', description: 'Carnet de vaccination à jour', required: false, enabled: false, acceptedExtensions: ['jpg', 'png', 'pdf'] },
    { type: 'border_pass', label: 'Laissez-passer frontalier', description: 'Document frontalier valide', required: false, enabled: false, acceptedExtensions: ['jpg', 'png', 'pdf'] }, { type: 'selfie', label: 'Selfie avec CNI', description: 'Photo de vous tenant votre CNI', required: false, enabled: false, acceptedExtensions: ['jpg', 'png'] },
];
// ── Bot assistant ─────────────────────────────────────────────────────────
SettingsController.BOT_PROVIDERS = ['claude', 'openai', 'zhipu', 'gemini'];
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SettingsController.prototype, "getAll", null);
__decorate([
    (0, common_1.Patch)('key'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [SetAppSettingDto]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setKey", null);
__decorate([
    (0, common_1.Get)('sms-routing'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getSmsRouting", null);
__decorate([
    (0, common_1.Put)('sms-routing'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [SetSmsRoutingDto, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setSmsRouting", null);
__decorate([
    (0, common_1.Get)('email-provider'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getEmailProvider", null);
__decorate([
    (0, common_1.Put)('email-provider'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setEmailProvider", null);
__decorate([
    (0, common_1.Get)('credentials'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getCredentials", null);
__decorate([
    (0, common_1.Put)('credentials'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setCredentials", null);
__decorate([
    (0, common_1.Get)('maps-key'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getMapsKey", null);
__decorate([
    (0, common_1.Put)('maps-key'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setMapsKey", null);
__decorate([
    (0, common_1.Get)('test-mode'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getTestMode", null);
__decorate([
    (0, common_1.Put)('test-mode'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setTestMode", null);
__decorate([
    (0, common_1.Get)('proximity-assignment'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getProximity", null);
__decorate([
    (0, common_1.Patch)('proximity-assignment'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [SetProximityDto]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setProximity", null);
__decorate([
    (0, common_1.Patch)('payment-security'),
    (0, require_permission_decorator_1.RequirePermission)('manage_payment_security'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setPaymentSecurity", null);
__decorate([
    (0, common_1.Get)('payment-providers'),
    (0, require_permission_decorator_1.RequirePermission)('view_payment_providers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getPaymentProviders", null);
__decorate([
    (0, common_1.Put)('payment-providers'),
    (0, require_permission_decorator_1.RequirePermission)('manage_payment_providers'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setPaymentProviders", null);
__decorate([
    (0, common_1.Get)('points-packages'),
    (0, require_permission_decorator_1.RequirePermission)('view_tariffs'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getPointsPackages", null);
__decorate([
    (0, common_1.Patch)('points-packages'),
    (0, require_permission_decorator_1.RequirePermission)('edit_tariffs'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setPointsPackages", null);
__decorate([
    (0, common_1.Get)('driver-documents'),
    (0, require_permission_decorator_1.RequirePermission)('view_drivers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getDriverDocumentConfig", null);
__decorate([
    (0, common_1.Patch)('driver-documents'),
    (0, require_permission_decorator_1.RequirePermission)('verify_driver'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setDriverDocumentConfig", null);
__decorate([
    (0, common_1.Get)('driver-documents/all'),
    (0, require_permission_decorator_1.RequirePermission)('view_drivers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getAllDocumentTypes", null);
__decorate([
    (0, common_1.Get)('bot'),
    (0, require_permission_decorator_1.RequirePermission)('view_settings'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getBotSettings", null);
__decorate([
    (0, common_1.Patch)('bot'),
    (0, require_permission_decorator_1.RequirePermission)('edit_settings'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "setBotSettings", null);
exports.SettingsController = SettingsController = SettingsController_1 = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('admin/settings'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard, permissions_guard_1.PermissionsGuard),
    (0, decorators_1.Roles)('admin'),
    __metadata("design:paramtypes", [settings_service_1.SettingsService, audit_service_1.AuditService])
], SettingsController);
//# sourceMappingURL=settings.controller.js.map