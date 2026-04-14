/**
 * 6.B10 — Seed RBAC : 45 permissions + 4 rôles système + matrice complète
 * Utiliser : npx ts-node prisma/seed-rbac.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── 45 Permissions ────────────────────────────────────────────────────────────

const PERMISSIONS: Array<{ key: string; group: string; description: string }> = [
  // analytics (1)
  { key: 'view_stats',                 group: 'analytics',  description: 'Voir le dashboard et les métriques' },
  // drivers (5)
  { key: 'view_drivers',              group: 'drivers',    description: 'Voir la liste des chauffeurs' },
  { key: 'view_driver_documents',     group: 'drivers',    description: 'Consulter les documents KYC' },
  { key: 'verify_driver',             group: 'drivers',    description: 'Approuver / Rejeter un dossier KYC' },
  { key: 'suspend_driver',            group: 'drivers',    description: 'Suspendre / Réactiver un chauffeur' },
  { key: 'edit_driver_profile',       group: 'drivers',    description: 'Modifier type de chauffeur, consigne' },
  // users (4)
  { key: 'view_users',                group: 'users',      description: 'Voir la liste des utilisateurs' },
  { key: 'suspend_user',              group: 'users',      description: 'Suspendre / Réactiver un compte' },
  { key: 'delete_user',               group: 'users',      description: 'Supprimer définitivement un compte' },
  { key: 'adjust_points',             group: 'users',      description: 'Créditer / débiter des points manuellement (support client)' },
  // bookings (3)
  { key: 'view_bookings',             group: 'bookings',   description: 'Voir l\'historique des courses' },
  { key: 'view_active_bookings',      group: 'bookings',   description: 'Voir les courses actives en temps réel' },
  { key: 'cancel_booking',            group: 'bookings',   description: 'Annuler une course' },
  // tariffs (3)
  { key: 'view_tariffs',              group: 'tariffs',    description: 'Voir la configuration tarifaire' },
  { key: 'edit_tariffs',              group: 'tariffs',    description: 'Modifier les tarifs (global + par pays)' },
  { key: 'rollback_tariffs',          group: 'tariffs',    description: 'Restaurer un snapshot tarifaire antérieur' },
  // airports (4)
  { key: 'view_airports',             group: 'airports',   description: 'Voir la liste des aéroports' },
  { key: 'create_airport',            group: 'airports',   description: 'Ajouter un aéroport' },
  { key: 'edit_airport',              group: 'airports',   description: 'Modifier un aéroport' },
  { key: 'delete_airport',            group: 'airports',   description: 'Supprimer un aéroport' },
  // promos (4)
  { key: 'view_promos',               group: 'promos',     description: 'Voir les codes promo' },
  { key: 'create_promo',              group: 'promos',     description: 'Créer un code promo' },
  { key: 'edit_promo',                group: 'promos',     description: 'Modifier un code promo' },
  { key: 'delete_promo',              group: 'promos',     description: 'Supprimer un code promo' },
  // reports (2)
  { key: 'view_reports',              group: 'reports',    description: 'Voir les signalements' },
  { key: 'handle_report',             group: 'reports',    description: 'Traiter / Fermer un signalement' },
  // referrals (1)
  { key: 'view_referrals',            group: 'referrals',  description: 'Voir les parrainages et bonus distribués' },
  // audit (1)
  { key: 'view_audit_logs',           group: 'audit',      description: 'Consulter les logs d\'audit admin' },
  // settings (7)
  { key: 'view_settings',             group: 'settings',   description: 'Voir les paramètres système' },
  { key: 'edit_settings',             group: 'settings',   description: 'Modifier les paramètres système' },
  { key: 'manage_test_mode',          group: 'settings',   description: 'Activer / Désactiver le mode test OTP' },
  { key: 'manage_sms_providers',      group: 'settings',   description: 'Configurer les providers SMS par pays' },
  { key: 'manage_email_providers',    group: 'settings',   description: 'Configurer le provider email' },
  { key: 'manage_otp_templates',      group: 'settings',   description: 'Éditer les templates OTP multilingues' },
  { key: 'test_otp_provider',         group: 'settings',   description: 'Déclencher un test d\'envoi depuis l\'admin' },
  // admin_mgmt (6)
  { key: 'view_admins',               group: 'admin_mgmt', description: 'Voir la liste des comptes admin' },
  { key: 'create_admin',              group: 'admin_mgmt', description: 'Créer un compte admin' },
  { key: 'edit_admin',                group: 'admin_mgmt', description: 'Modifier un compte admin' },
  { key: 'delete_admin',              group: 'admin_mgmt', description: 'Supprimer un compte admin' },
  { key: 'assign_role',               group: 'admin_mgmt', description: 'Assigner / Retirer un rôle à un admin' },
  { key: 'assign_permission',         group: 'admin_mgmt', description: 'Override direct de permission sur un admin' },
  // roles (5)
  { key: 'view_roles',                group: 'roles',      description: 'Voir la liste des rôles' },
  { key: 'create_role',               group: 'roles',      description: 'Créer un rôle personnalisé' },
  { key: 'edit_role',                 group: 'roles',      description: 'Modifier le label / description d\'un rôle' },
  { key: 'delete_role',               group: 'roles',      description: 'Supprimer un rôle non-système' },
  { key: 'assign_permissions_to_role',group: 'roles',      description: 'Modifier la matrice permissions d\'un rôle' },
];

// ── Matrice rôles / permissions ───────────────────────────────────────────────

const ROLE_MATRIX: Record<string, string[]> = {
  super_admin: PERMISSIONS.map(p => p.key), // toutes
  admin: [
    'view_stats',
    'view_drivers','view_driver_documents','verify_driver','suspend_driver','edit_driver_profile',
    'view_users','suspend_user','delete_user','adjust_points',
    'view_bookings','view_active_bookings','cancel_booking',
    'view_tariffs','edit_tariffs','rollback_tariffs',
    'view_airports','create_airport','edit_airport',
    'view_promos','create_promo','edit_promo','delete_promo',
    'view_reports','handle_report',
    'view_referrals',
    'view_audit_logs',
    'view_settings','edit_settings','manage_otp_templates','test_otp_provider',
    'view_roles',
  ],
  moderator: [
    'view_stats',
    'view_drivers','view_driver_documents','verify_driver','suspend_driver',
    'view_users','suspend_user',
    'view_bookings','view_active_bookings','cancel_booking',
    'view_promos',
    'view_reports','handle_report',
    'view_referrals',
  ],
  support: [
    'view_stats',
    'view_drivers','view_driver_documents',
    'view_users','adjust_points',
    'view_bookings','view_active_bookings',
    'view_promos',
    'view_reports',
    'view_referrals',
  ],
};

const ROLES: Array<{ name: string; label: string; description: string }> = [
  { name: 'super_admin', label: 'Super Administrateur', description: 'Accès complet à toutes les fonctionnalités' },
  { name: 'admin',       label: 'Administrateur',       description: 'Gestion complète sauf admin_mgmt et super_admin settings' },
  { name: 'moderator',   label: 'Modérateur',           description: 'Gestion chauffeurs, utilisateurs, courses, signalements' },
  { name: 'support',     label: 'Support',              description: 'Lecture seule — assistance utilisateurs' },
];

async function main() {
  console.log('Seeding RBAC...');

  // 1. Upsert permissions
  console.log('\n1. Permissions...');
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { group: p.group, description: p.description },
      create: p,
    });
    console.log(`  ✓ ${p.key}`);
  }

  // 2. Upsert rôles
  console.log('\n2. Rôles...');
  for (const r of ROLES) {
    await prisma.adminRole.upsert({
      where: { name: r.name },
      update: { label: r.label, description: r.description },
      create: { ...r, isSystem: true },
    });
    console.log(`  ✓ ${r.name}`);
  }

  // 3. Matrice role → permissions
  console.log('\n3. Matrice rôles / permissions...');
  for (const [roleName, permKeys] of Object.entries(ROLE_MATRIX)) {
    const role = await prisma.adminRole.findUnique({ where: { name: roleName } });
    if (!role) continue;

    // Supprimer les anciennes associations pour reconstruire proprement
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    for (const key of permKeys) {
      const perm = await prisma.permission.findUnique({ where: { key } });
      if (!perm) continue;
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: perm.id },
      });
    }
    console.log(`  ✓ ${roleName} → ${permKeys.length} permissions`);
  }

  console.log('\n✅ RBAC seedé : 45 permissions, 4 rôles système.');
}

main()
  .catch((e) => { console.error('Seed RBAC error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
