import { runWithTenant } from './tenant-context';
import { ZERO_TENANT_ID } from './tenant.constants';

/**
 * Décorateur pour les handlers de gateway WebSocket (@SubscribeMessage, handleDisconnect…).
 * Les événements socket ne passent PAS par l'interceptor HTTP → pas de contexte tenant.
 * Ce décorateur exécute le handler dans le contexte du tenant du socket
 * (`client.data.tenantId`, posé au handleConnection), défaut tenant zéro.
 *
 * Il détecte l'argument socket parmi les paramètres (objet ayant `.emit` et `.data`),
 * ce qui couvre @ConnectedSocket() comme le `client` de handleDisconnect.
 */
export function SocketTenantScoped(): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    descriptor.value = function (...args: any[]) {
      const sock = args.find(
        (a) => a && typeof a === 'object' && a.data && typeof a.emit === 'function',
      );
      const tenantId: string = sock?.data?.tenantId ?? ZERO_TENANT_ID;
      return runWithTenant(
        { tenantId, platformScope: false },
        async () => original.apply(this, args),
      );
    };
    return descriptor;
  };
}
