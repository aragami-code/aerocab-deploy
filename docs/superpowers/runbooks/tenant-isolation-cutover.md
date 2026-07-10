# Runbook — Bascule isolation multi-tenant (WARN → ENFORCE)

Prérequis : sous-projet 1 (cœur multi-tenant) déployé, `TENANT_ISOLATION_MODE=warn` en prod.

## Rappel du mécanisme (Prisma 6)
- L'isolation passe par un **Client Extension** (`$extends`) monté dans `PrismaService`
  (proxy → délégués de modèle + `$transaction` routés vers le client étendu).
- Le contexte tenant de la requête est posé par `TenantInterceptor` via
  `AsyncLocalStorage.enterWith` (les promesses Prisma étant lazy, un `run()` ne suffit pas).
- Mode piloté par `process.env.TENANT_ISOLATION_MODE` : `warn` (défaut) ou `enforce`.

## Phase C (observation)
1. Déployer avec `TENANT_ISOLATION_MODE=warn`.
2. Exécuter le seed + backfill : `npx ts-node prisma/seed-tenant-zero.ts`
   (crée le tenant `aerogo` + rattache toutes les lignes `tenant_id IS NULL`).
3. Vérifier `SELECT count(*) ... WHERE tenant_id IS NULL = 0` sur les modèles scopés,
   puis rendre `tenant_id` **NOT NULL** (passer chaque `tenantId String?` → `String`
   dans `schema.prisma`, puis `npx prisma db push`).
4. Laisser tourner 3-7 jours. Surveiller les logs
   `[tenant-isolation] ... sans tenant résolu`.
5. Objectif : **zéro** warning. Chaque warning = un chemin hors requête HTTP
   (cron, webhook, scheduler, job système) qui s'exécute sans contexte tenant.
   Le corriger en enveloppant l'appel dans un contexte explicite :
   - jobs système multi-tenant : `runWithTenant({ tenantId, platformScope: false }, async () => …)`
   - opérations control-plane inter-tenant : `platformScope: true`.
   Rappel : passer des callbacks **async** à `runWithTenant` (promesses Prisma lazy).

## Phase D (enforcement)
6. Warnings à zéro → passer `TENANT_ISOLATION_MODE=enforce`, redéployer.
7. Vérifier le health + un parcours passager complet sur le tenant zéro.
8. Rollback : repasser `TENANT_ISOLATION_MODE=warn` et redéployer
   (aucune migration à annuler).

## Garde-fous
- `findUnique`/`findUniqueOrThrow` sont **post-filtrés** par tenantId (une extension
  ne peut pas réécrire l'opération) → une lecture par clé d'un autre tenant renvoie `null`.
- `$transaction` est routé vers le client étendu → les opérations en transaction
  restent isolées.
- Les modèles partagés (Country, Airport, Permission, AdminRole, RolePermission)
  et `AppSetting` (cascade) ne sont **pas** filtrés.
