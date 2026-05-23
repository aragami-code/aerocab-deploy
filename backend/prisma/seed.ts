/**
 * 0.B2 — Seed 31 clés AppSetting avec valeurs par défaut.
 * Utiliser : npx ts-node prisma/seed.ts
 * Toutes les valeurs peuvent être modifiées depuis l'admin sans redéploiement.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APP_SETTINGS: Array<{ key: string; value: string; description?: string }> = [
  // ─── Tracking / Localisation ─────────────────────────────────────────────
  { key: 'driver_position_interval_ms',    value: '30000',  description: 'Intervalle envoi position chauffeur (ms)' },
  { key: 'tracking_poll_2g_ms',            value: '15000',  description: 'Intervalle polling tracking passager en 2G (ms)' },
  { key: 'tracking_poll_3g_ms',            value: '8000',   description: 'Intervalle polling tracking passager en 3G (ms)' },
  { key: 'tracking_poll_4g_ms',            value: '5000',   description: 'Intervalle polling tracking passager en 4G (ms)' },

  // ─── Dispatch ────────────────────────────────────────────────────────────
  { key: 'proximity_radius_km',            value: '20',     description: 'Rayon de recherche chauffeur proche (km)' },
  { key: 'proximity_radius_extended_km',   value: '25',     description: 'Rayon étendu si pas assez de chauffeurs (km)' },
  { key: 'dispatch_prelanding_limit',      value: '50',     description: 'Nb max chauffeurs candidats pré-atterrissage' },
  { key: 'dispatch_nearby_limit',          value: '20',     description: 'Nb max chauffeurs candidats course normale' },
  { key: 'dispatch_global_limit',          value: '5',      description: 'Nb max chauffeurs à notifier en parallèle' },
  { key: 'min_driver_score',               value: '4.0',    description: 'Score minimum pour recevoir des courses' },
  { key: 'dispatch_weight_reputation',     value: '0.7',    description: 'Poids réputation dans le score de dispatch' },
  { key: 'dispatch_weight_rating',         value: '0.3',    description: 'Poids notation dans le score de dispatch' },
  { key: 'max_route_distance_km',          value: '80',     description: 'Distance max trajet acceptée (km)' },

  // ─── Timeouts & Timings ───────────────────────────────────────────────────
  { key: 'booking_assignment_timeout_min',  value: '10',    description: 'Timeout assignation chauffeur (minutes)' },
  { key: 'booking_passenger_timeout_ms',    value: '60000', description: 'Délai annulation gratuite passager (ms)' },
  { key: 'passenger_confirm_timeout_min',   value: '5',     description: 'Délai confirmation passager après arrivée (min)' },
  { key: 'dispatch_scheduled_advance_min',  value: '60',    description: 'Avance (minutes) pour dispatcher les réservations programmées avant l\'heure' },

  // ─── Objectifs journaliers chauffeur ──────────────────────────────────────
  { key: 'daily_goals', value: JSON.stringify({ rides: 5, earnings: 25000, rating: 4.5 }), description: 'Objectifs journaliers chauffeur (JSON : rides, earnings en FCFA, rating)' },

  // ─── Vols ─────────────────────────────────────────────────────────────────
  { key: 'flight_sync_interval_minutes',   value: '10',     description: 'Intervalle synchronisation statuts vols (min)' },
  { key: 'flight_sync_window_hours',       value: '6',      description: 'Fenêtre de temps vols à synchroniser (heures)' },
  { key: 'flight_batch_size',              value: '20',     description: 'Nombre de vols traités par batch de sync' },

  // ─── Prix ────────────────────────────────────────────────────────────────
  { key: 'price_change_tolerance_percent', value: '5',      description: 'Tolérance variation prix avant reconfirmation (%)' },
  { key: 'vehicle_capacity',               value: '{"eco":4,"eco_plus":4,"standard":5,"confort":5,"confort_plus":7}', description: 'Capacité max passagers par catégorie véhicule (JSON)' },

  // ─── OTP ─────────────────────────────────────────────────────────────────
  { key: 'otp_expiry_minutes',             value: '5',      description: 'Durée de validité d\'un OTP (minutes)' },
  { key: 'otp_max_attempts',               value: '3',      description: 'Nombre max de tentatives OTP avant blocage' },
  { key: 'otp_cooldown_minutes',           value: '10',     description: 'Délai de refroidissement après trop d\'essais (min)' },
  { key: 'jwt_expiry_days',                value: '30',     description: 'Durée de validité du JWT (jours)' },

  // ─── Intégrations externes ───────────────────────────────────────────────
  { key: 'google_maps_key',           value: 'AIzaSyBjA53emT-qNJLICKLz13W5RRBU55KZqzM', description: 'Clé Google Maps API (Directions, Geocoding)' },
  // Flutterwave
  { key: 'payment_flutterwave_secret_key',   value: '', description: 'Flutterwave Secret Key (FLWSECK_TEST-...)' },
  { key: 'payment_flutterwave_webhook_hash', value: '', description: 'Flutterwave Webhook Hash (Secret Hash configuré dans le dashboard)' },
  // CinetPay
  { key: 'payment_cinetpay_api_key',  value: '', description: 'CinetPay API Key' },
  { key: 'payment_cinetpay_site_id',  value: '', description: 'CinetPay Site ID' },
  // NotchPay
  { key: 'payment_notchpay_public_key',    value: '', description: 'NotchPay Public Key (pk.xxx)' },
  { key: 'payment_notchpay_private_key',   value: '', description: 'NotchPay Private Key (sk.xxx)' },
  { key: 'payment_notchpay_webhook_secret',value: '', description: 'NotchPay Webhook Secret' },
  // Stripe
  { key: 'payment_stripe_secret_key',      value: '', description: 'Stripe Secret Key (sk_test_... ou sk_live_...)' },
  { key: 'payment_stripe_webhook_secret',  value: '', description: 'Stripe Webhook Secret (whsec_...)' },
  // M-Pesa
  { key: 'payment_mpesa_consumer_key',     value: '', description: 'M-Pesa Consumer Key (portail developer.safaricom.co.ke)' },
  { key: 'payment_mpesa_consumer_secret',  value: '', description: 'M-Pesa Consumer Secret' },
  { key: 'payment_mpesa_shortcode',        value: '', description: 'M-Pesa Business Shortcode (Paybill ou Till number)' },
  { key: 'payment_mpesa_passkey',          value: '', description: 'M-Pesa Lipa na M-Pesa Online Passkey' },
  // PayPal
  { key: 'payment_paypal_client_id',       value: '', description: 'PayPal Client ID (sandbox ou live)' },
  { key: 'payment_paypal_client_secret',   value: '', description: 'PayPal Client Secret' },
  { key: 'payment_paypal_webhook_id',      value: '', description: 'PayPal Webhook ID (configuré dans le portail developer.paypal.com)' },
  // Wave
  { key: 'payment_wave_api_key',           value: '', description: 'Wave API Key (wave_sn_prod_... ou wave_sn_test_...)' },
  { key: 'payment_wave_webhook_secret',    value: '', description: 'Wave Webhook Secret' },
  // Twilio
  { key: 'twilio_account_sid',        value: '', description: 'Twilio Account SID (ex: ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)' },
  { key: 'twilio_auth_token',         value: '', description: 'Twilio Auth Token' },
  { key: 'twilio_phone_number',       value: '', description: 'Numéro expéditeur Twilio au format E.164 (ex: +12015551234)' },
  // Orange Cameroun
  { key: 'orange_cm_client_id',       value: '', description: 'Orange CM Client ID (portail developer.orange.com)' },
  { key: 'orange_cm_client_secret',   value: '', description: 'Orange CM Client Secret' },
  { key: 'orange_cm_sender_address',  value: '', description: 'Adresse expéditeur Orange CM (ex: tel:+237XXXXXXXXX)' },
  // Africa's Talking
  { key: 'at_api_key',               value: '', description: "Africa's Talking API Key" },
  { key: 'at_username',              value: 'sandbox', description: "Africa's Talking username (sandbox ou nom de compte)" },
  { key: 'at_sender_id',             value: '', description: "Africa's Talking Sender ID (optionnel)" },
  // SendGrid
  { key: 'sendgrid_api_key',         value: '', description: 'SendGrid API Key (SG.xxxxxxxx)' },
  { key: 'sendgrid_from_email',      value: 'noreply@aerogo24.com', description: 'Adresse expéditeur SendGrid' },

  // ─── Mode Test OTP ───────────────────────────────────────────────────────
  { key: 'test_mode_enabled',              value: 'true',   description: 'Active le mode test OTP — désactiver en production via admin dashboard' },
  { key: 'test_otp_value',                 value: '000000', description: 'Code OTP fixe utilisé en mode test (4–8 chiffres)' },
  { key: 'otp_log_enabled',               value: 'false',  description: 'Log OTP en clair dans les logs serveur (auto-activé en mode test)' },

  // ─── Routage SMS / Canal OTP ──────────────────────────────────────────────
  { key: 'otp_channel',                    value: 'sms',    description: 'Canal d\'envoi OTP : sms | email | both' },
  { key: 'sms_routing_rules',              value: '{"+237":"mock","+221":"mock","default":"mock"}', description: 'Règles routage SMS par préfixe pays E.164 avec + (JSON). Ex: {"+237":"orange-cm","+221":"africas-talking","default":"twilio"}' },
  { key: 'email_provider',                 value: 'mock',   description: 'Fournisseur email : mock | sendgrid | smtp' },

  // ─── SMTP (configurable admin, fallback env vars) ─────────────────────────
  { key: 'smtp_host',       value: '', description: 'Serveur SMTP (ex: smtp.gmail.com, smtp.sendgrid.net)' },
  { key: 'smtp_port',       value: '587', description: 'Port SMTP : 587 (TLS), 465 (SSL), 25 (non chiffré)' },
  { key: 'smtp_user',       value: '', description: 'Identifiant SMTP (adresse email ou login)' },
  { key: 'smtp_pass',       value: '', description: 'Mot de passe SMTP ou mot de passe d\'application' },
  { key: 'smtp_from_email', value: '', description: 'Adresse expéditeur (ex: noreply@aerocab.com)' },

  // ─── Templates OTP multilingues ───────────────────────────────────────────
  { key: 'otp_email_subject',              value: 'Votre code AeroGo 24', description: 'Sujet email OTP' },
  { key: 'otp_template_fr',               value: 'Votre code de vérification AeroGo 24 est {{code}}. Valable {{expiry}} min.', description: 'Template SMS/email OTP en français' },
  { key: 'otp_template_en',               value: 'Your AeroGo 24 verification code is {{code}}. Valid for {{expiry}} min.', description: 'Template SMS/email OTP en anglais' },

  // ─── Sécurité paiements ───────────────────────────────────────────────────
  { key: 'payment_max_recharge_amount',    value: '500000', description: 'Montant max de recharge par transaction (XAF)' },
  { key: 'withdrawal_min_amount',          value: '1000',   description: 'Montant minimum de retrait chauffeur (XAF)' },
  { key: 'withdrawal_max_amount',          value: '100000', description: 'Montant maximum de retrait par demande (XAF)' },
  { key: 'withdrawal_max_daily_amount',    value: '200000', description: 'Plafond journalier cumulé de retrait chauffeur (XAF)' },
  { key: 'withdrawal_carence_hours',       value: '24',     description: 'Délai minimum (heures) entre une recharge et un retrait' },

  // ─── URL du backend (utilisée pour les callbacks/webhooks de paiement) ──────
  { key: 'backend_url', value: 'https://aerocab-api.onrender.com', description: 'URL publique du backend pour les webhooks de paiement (ex: https://aerocab-api.onrender.com)' },

  // ─── Fournisseurs de paiement (activation par provider) ──────────────────
  { key: 'payment_cinetpay_enabled',       value: 'true',   description: 'Activer CinetPay comme fournisseur de paiement' },
  { key: 'payment_flutterwave_enabled',    value: 'true',   description: 'Activer Flutterwave comme fournisseur de paiement' },
  { key: 'payment_stripe_enabled',         value: 'true',   description: 'Activer Stripe comme fournisseur de paiement' },
  { key: 'payment_notchpay_enabled',       value: 'false',  description: 'Activer NotchPay comme fournisseur de paiement' },
  { key: 'payment_mpesa_enabled',          value: 'false',  description: 'Activer M-Pesa comme fournisseur de paiement' },
  { key: 'payment_paypal_enabled',         value: 'false',  description: 'Activer PayPal comme fournisseur de paiement' },
  { key: 'payment_wave_enabled',           value: 'false',  description: 'Activer Wave comme fournisseur de paiement' },
  { key: 'payment_edoctor_enabled',        value: 'false',  description: 'Activer EdoctorPay comme fournisseur de paiement' },

  // ── Forfaits de recharge de points ──────────────────────────────────────────
  { key: 'points_recharge_packages', value: '[1000,3000,5000,10000]', description: 'Forfaits de recharge de points disponibles (tableau JSON de nombres entiers)' },

  // ── Configuration documents chauffeur ───────────────────────────────────────
  { key: 'driver_document_config', value: JSON.stringify([
    { type: 'cni_front',          label: 'CNI — Recto',              description: 'Face avant de votre carte nationale',        required: true,  enabled: true,  acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'cni_back',           label: 'CNI — Verso',              description: "Face arrière de votre carte nationale",      required: true,  enabled: true,  acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'license',            label: 'Permis de conduire',       description: 'Permis en cours de validité',                required: true,  enabled: true,  acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'registration',       label: 'Carte grise',              description: "Document d'immatriculation du véhicule",    required: true,  enabled: true,  acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'vehicle_photo',      label: 'Photo du véhicule',        description: 'Vue de face du véhicule',                    required: true,  enabled: true,  acceptedExtensions: ['jpg','png'] },
    { type: 'insurance',          label: "Attestation d'assurance",  description: 'Attestation couvrant le transport de personnes', required: false, enabled: false, acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'technical_control',  label: 'Visite technique',         description: 'Contrôle technique en cours de validité',   required: false, enabled: false, acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'vtc_license',        label: 'Autorisation VTC',         description: 'Autorisation officielle de transport VTC',  required: false, enabled: false, acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'passport',           label: 'Passeport',                description: 'Passeport en cours de validité',             required: false, enabled: false, acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'portrait',           label: 'Photo portrait',           description: 'Selfie face caméra, fond neutre',            required: false, enabled: false, acceptedExtensions: ['jpg','png'] },
    { type: 'criminal_record',    label: 'Casier judiciaire',        description: 'Bulletin n°3 daté de moins de 3 mois',      required: false, enabled: false, acceptedExtensions: ['pdf'] },
    { type: 'proof_of_address',   label: 'Justificatif de domicile', description: 'Facture ou relevé de moins de 3 mois',      required: false, enabled: false, acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'medical_certificate',label: 'Certificat médical',       description: "Attestation d'aptitude à la conduite",      required: false, enabled: false, acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'vaccination_card',   label: 'Carte de vaccination',     description: 'Carnet de vaccination à jour',               required: false, enabled: false, acceptedExtensions: ['jpg','png','pdf'] },
    { type: 'border_pass',        label: 'Laissez-passer frontalier',description: 'Document frontalier valide',                 required: false, enabled: false, acceptedExtensions: ['jpg','png','pdf'] },
  ]), description: 'Configuration des documents chauffeur (JSON) : liste {type, label, description, required, enabled, acceptedExtensions}' },

  // ── Pass d'accès passager (configurable admin) ──────────────────────────────
  { key: 'access_pass_enabled',        value: 'false',  description: 'Activer le pass d\'accès payant pour les passagers (true/false)' },
  { key: 'access_pass_price_fcfa',     value: '2000',   description: 'Prix du pass en FCFA (ex: 2000 = 2 000 FCFA/mois)' },
  { key: 'access_pass_duration_days',  value: '30',     description: 'Durée de validité du pass en jours (ex: 30 = mensuel, 7 = hebdomadaire)' },
  { key: 'access_pass_trial_days',     value: '7',      description: 'Jours d\'essai gratuit pour les nouveaux passagers (0 = pas d\'essai)' },
  { key: 'access_pass_grace_days',     value: '2',      description: 'Jours de grâce après expiration avant blocage complet' },

  // ── Bot Assistant ────────────────────────────────────────────────────────────
  { key: 'bot_enabled',          value: 'false',  description: 'Activer le bot assistant IA (true/false)' },
  { key: 'bot_provider',         value: 'claude', description: 'Fournisseur IA actif : claude | openai | zhipu' },
  { key: 'bot_claude_api_key',   value: '',       description: 'Clé API Anthropic (sk-ant-...) — utilisée si bot_provider=claude' },
  { key: 'bot_openai_api_key',   value: '',       description: 'Clé API OpenAI (sk-...) — utilisée si bot_provider=openai' },
  { key: 'bot_zhipu_api_key',    value: '',       description: 'Clé API ZhipuAI (GLM) — utilisée si bot_provider=zhipu' },
  { key: 'bot_model',            value: 'claude-haiku-4-5-20251001', description: 'Modèle IA à utiliser (ex: claude-haiku-4-5-20251001 | gpt-4o-mini | glm-4-flash)' },
  { key: 'bot_max_tokens',       value: '500',    description: 'Nombre max de tokens dans la réponse du bot' },
  { key: 'bot_system_prompt',    value: 'Tu es l\'assistant AeroCab. Réponds en français, de façon concise et amicale. Si tu ne sais pas, propose de contacter le support.', description: 'System prompt du bot (personnalisable sans redéploiement)' },
];

async function main() {
  console.log('Seeding AppSettings...');

  for (const setting of APP_SETTINGS) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: {},  // Ne pas écraser les valeurs existantes (modifiées par l'admin)
      create: { key: setting.key, value: setting.value },
    });
    console.log(`  ✓ ${setting.key}`);
  }

  console.log(`\n✅ ${APP_SETTINGS.length} AppSettings seedées.`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
