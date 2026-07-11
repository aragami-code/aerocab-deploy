import { BrandingService } from './branding.service';

describe('BrandingService.update', () => {
  it('met à jour les champs fournis et renvoie le bloc résolu', async () => {
    const resolved = {
      primaryColor: '#333333', accentColor: '#444444', logoUrl: null,
      appNamePassenger: 'X', appNameDriver: 'X Pro', paletteId: 'ocean',
    };
    const update = jest.fn().mockResolvedValue(resolved);
    const findUnique = jest.fn().mockResolvedValue(resolved);
    const prisma: any = { tenant: { update, findUnique } };
    const svc = new BrandingService(prisma);
    const out = await svc.update('taxiplus', { primaryColor: '#333333', paletteId: 'ocean' } as any);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'taxiplus' },
      data: expect.objectContaining({ primaryColor: '#333333', paletteId: 'ocean' }),
    }));
    expect(out.primaryColor).toBe('#333333');
  });
});
