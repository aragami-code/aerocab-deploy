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
  { key: 'booking_assignment_timeout_min', value: '10',     description: 'Timeout assignation chauffeur (minutes)' },
  { key: 'booking_passenger_timeout_ms',   value: '60000',  description: 'Délai annulation gratuite passager (ms)' },
  { key: 'passenger_confirm_timeout_min',  value: '5',      description: 'Délai confirmation passager après arrivée (min)' },

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

  // ─── Mode Test OTP ───────────────────────────────────────────────────────
  { key: 'test_mode_enabled',              value: 'false',  description: 'Active le mode test OTP (désactiver en production)' },
  { key: 'test_otp_value',                 value: '123456', description: 'Valeur OTP fixe en mode test' },

  // ─── Routage SMS / Canal OTP ──────────────────────────────────────────────
  { key: 'otp_channel',                    value: 'sms',    description: 'Canal d\'envoi OTP : sms | email | both' },
  { key: 'sms_routing_rules',              value: '{"+237":"mock","+221":"mock","default":"mock"}', description: 'Règles routage SMS par préfixe pays E.164 avec + (JSON). Ex: {"+237":"orange-cm","+221":"africas-talking","default":"twilio"}' },
  { key: 'email_provider',                 value: 'mock',   description: 'Fournisseur email : mock | sendgrid | smtp' },

  // ─── Templates OTP multilingues ───────────────────────────────────────────
  { key: 'otp_email_subject',              value: 'Votre code AeroGo 24', description: 'Sujet email OTP' },
  { key: 'otp_template_fr',               value: 'Votre code de vérification AeroGo 24 est {{code}}. Valable {{expiry}} min.', description: 'Template SMS/email OTP en français' },
  { key: 'otp_template_en',               value: 'Your AeroGo 24 verification code is {{code}}. Valid for {{expiry}} min.', description: 'Template SMS/email OTP en anglais' },
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
