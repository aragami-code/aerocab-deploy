import { runWithTenant } from './tenant-context';

/**
 * Décorateur de méthode : exécute la méthode dans un contexte tenant « plateforme »
 * (platformScope: true → l'isolation ne filtre pas). À poser sur les jobs système
 * qui tournent HORS requête HTTP (cron/scheduler) et opèrent sur tous les tenants.
 *
 * Ordre à respecter : @Cron AU-DESSUS de @PlatformScoped, pour que le callback
 * enregistré par @Cron soit la version déjà enveloppée.
 *
 *   @Cron('* * * * *')
 *   @PlatformScoped()
 *   async expireBookings() { ... }
 *
 * Le callback interne est `async` pour adopter la promesse de la méthode DANS le
 * contexte ALS (les promesses Prisma sont lazy).
 */
export function PlatformScoped(): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    descriptor.value = function (...args: any[]) {
      return runWithTenant(
        { tenantId: null, platformScope: true },
        async () => original.apply(this, args),
      );
    };
    return descriptor;
  };
}
