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
          // findUnique ne peut pas être réécrit en findFirst dans une extension
          // ($allOperations ne change pas l'opération) : on post-filtre le résultat
          // par tenantId pour éviter une lecture cross-tenant par clé unique.
          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            const ctx = getTenantContext();
            if (!model || !TENANT_SCOPED_MODELS.has(model) || ctx?.platformScope) {
              return query(args);
            }
            const tenantId = ctx?.tenantId ?? null;
            if (!tenantId) {
              const msg = `[tenant-isolation] ${model}.${operation} sans tenant résolu`;
              if (opts.mode === 'enforce') {
                throw new Error(msg + ' — requête bloquée (fail-closed)');
              }
              opts.onViolation(msg);
              return query(args);
            }
            const res: any = await query(args);
            if (res && res.tenantId !== undefined && res.tenantId !== tenantId) {
              if (operation === 'findUniqueOrThrow') {
                throw new Error(`No ${model} found (tenant scope)`);
              }
              return null;
            }
            return res;
          }

          const scoped = applyTenantScope(model, operation, args ?? {}, opts);
          return query(scoped.args);
        },
      },
    },
  });
}
