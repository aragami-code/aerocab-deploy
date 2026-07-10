import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_MODELS } from './tenant.constants';
import { getTenantContext } from './tenant-context';

export interface TenantMiddlewareOptions {
  mode: 'warn' | 'enforce';
  onViolation: (message: string) => void;
}

const READ_INJECT = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
]);
const WHERE_INJECT = new Set(['update', 'delete']);

export interface ScopeResult {
  /** Action éventuellement réécrite (findUnique → findFirst). */
  action: string;
  args: any;
}

/**
 * Cœur pur de l'isolation : calcule les args (et l'action) à exécuter pour un
 * modèle scopé, en fonction du contexte tenant courant. Indépendant de l'API
 * Prisma (testable en isolation). Jette en mode enforce si aucun tenant résolu.
 */
export function applyTenantScope(
  model: string | undefined,
  action: string,
  args: any,
  opts: TenantMiddlewareOptions,
): ScopeResult {
  if (!model || !TENANT_SCOPED_MODELS.has(model)) {
    return { action, args };
  }

  const ctx = getTenantContext();

  // Control plane / jobs système : accès explicite inter-tenant.
  if (ctx?.platformScope) return { action, args };

  const tenantId = ctx?.tenantId ?? null;
  if (!tenantId) {
    const msg = `[tenant-isolation] ${model}.${action} sans tenant résolu`;
    if (opts.mode === 'enforce') {
      throw new Error(msg + ' — requête bloquée (fail-closed)');
    }
    opts.onViolation(msg);
    return { action, args };
  }

  const a = { ...(args ?? {}) };
  let outAction = action;

  if (READ_INJECT.has(action) || WHERE_INJECT.has(action)) {
    a.where = { ...(a.where ?? {}), tenantId };
  } else if (action === 'findUnique' || action === 'findUniqueOrThrow') {
    outAction = action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
    a.where = { ...(a.where ?? {}), tenantId };
  } else if (action === 'create') {
    a.data = { ...(a.data ?? {}), tenantId };
  } else if (action === 'createMany') {
    const data = a.data;
    a.data = Array.isArray(data)
      ? data.map((d: any) => ({ ...d, tenantId }))
      : { ...data, tenantId };
  } else if (action === 'upsert') {
    a.where = { ...(a.where ?? {}), tenantId };
    a.create = { ...(a.create ?? {}), tenantId };
  }

  return { action: outAction, args: a };
}

/**
 * Client Extension Prisma 6 appliquant l'isolation.
 * NB : `$allOperations` ne peut pas changer le type d'opération. La réécriture
 * findUnique→findFirst est gérée par des overrides de modèle (voir Task 5 wiring).
 * Ici on injecte le filtre/données via les args pour toutes les opérations.
 */
export function createTenantExtension(opts: TenantMiddlewareOptions) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          const scoped = applyTenantScope(model, operation, args ?? {}, opts);
          return query(scoped.args);
        },
      },
    },
  });
}
