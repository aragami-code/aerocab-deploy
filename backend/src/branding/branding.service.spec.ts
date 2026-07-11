import { BrandingService } from './branding.service';

function svc(tenant: any) {
  const prisma = { tenant: { findUnique: async () => tenant } };
  return new BrandingService(prisma as any);
}

describe('BrandingService.resolve', () => {
  it('tenant avec branding → ses valeurs', async () => {
    const b = await svc({
      primaryColor: '#111111', accentColor: '#222222', logoUrl: 'u',
      appNamePassenger: 'TaxiPlus', appNameDriver: 'TaxiPlus Pro',
    }).resolve('taxiplus');
    expect(b).toEqual({
      primaryColor: '#111111', accentColor: '#222222', logoUrl: 'u',
      appNamePassenger: 'TaxiPlus', appNameDriver: 'TaxiPlus Pro',
    });
  });

  it('champs null → défauts plateforme', async () => {
    const b = await svc({
      primaryColor: null, accentColor: null, logoUrl: null,
      appNamePassenger: null, appNameDriver: null,
    }).resolve('aerogo');
    expect(b).toEqual({
      primaryColor: '#C0102E', accentColor: '#1E1E1E', logoUrl: null,
      appNamePassenger: 'AeroGo', appNameDriver: 'AeroGo Driver',
    });
  });

  it('tenant introuvable → défauts', async () => {
    const b = await svc(null).resolve('inconnu');
    expect(b.primaryColor).toBe('#C0102E');
    expect(b.appNamePassenger).toBe('AeroGo');
  });
});
