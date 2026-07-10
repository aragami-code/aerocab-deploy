import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string | null;
  /** true = super-admin / control plane : accès inter-tenant explicite et audité. */
  platformScope: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function getCurrentTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}

/**
 * Établit le contexte tenant pour l'exécution asynchrone courante et ses descendants,
 * SANS wrapper de callback. Nécessaire pour le flux requête (interceptor) car les
 * promesses Prisma sont lazy : un `runWithTenant(ctx, () => obs)` perdrait le contexte
 * au moment où l'opération est réellement exécutée (hors du scope run()).
 */
export function enterTenant(ctx: TenantContext): void {
  storage.enterWith(ctx);
}
