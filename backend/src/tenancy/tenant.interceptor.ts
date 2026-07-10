import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { enterTenant } from './tenant-context';
import { ZERO_TENANT_ID } from './tenant.constants';

/**
 * Établit le contexte tenant de la requête à partir de `req.user.tenantId`
 * (posé par la JwtStrategy). Utilise enterTenant/enterWith pour que le contexte
 * survive aux opérations Prisma lazy exécutées plus tard dans la requête.
 * Requête non authentifiée → tenant zéro (transition mono-tenant).
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const tenantId: string = req?.user?.tenantId ?? ZERO_TENANT_ID;
    enterTenant({ tenantId, platformScope: false });
    return next.handle();
  }
}
