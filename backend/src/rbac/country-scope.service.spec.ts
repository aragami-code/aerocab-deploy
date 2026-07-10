import { CountryScopeService } from './country-scope.service';

describe('CountryScopeService.getAdminCountryScope', () => {
  function make(rows: any[]) {
    const prisma = { userAdminRole: { findMany: async () => rows } } as any;
    return new CountryScopeService(prisma);
  }
  it('union des scopes des rôles', async () => {
    const svc = make([{ countryScope: ['SN'] }, { countryScope: ['KE'] }]);
    expect((await svc.getAdminCountryScope('u1')).sort()).toEqual(['KE', 'SN']);
  });
  it('un rôle global ([]) → accès tous pays (scope vide)', async () => {
    const svc = make([{ countryScope: [] }, { countryScope: ['SN'] }]);
    expect(await svc.getAdminCountryScope('u1')).toEqual([]); // [] = tous pays
  });
  it('isAllowed: scope vide autorise tout', async () => {
    const svc = make([{ countryScope: [] }]);
    expect(await svc.isAllowed('u1', 'CM')).toBe(true);
  });
  it('isAllowed: scopé refuse hors périmètre', async () => {
    const svc = make([{ countryScope: ['SN'] }]);
    expect(await svc.isAllowed('u1', 'CM')).toBe(false);
    expect(await svc.isAllowed('u1', 'SN')).toBe(true);
  });
});
