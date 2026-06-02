import { AnnouncementsService } from './announcements.service';

describe('AnnouncementsService.matchesUser (filtrage)', () => {
  const svc = new AnnouncementsService({} as any, {} as any, {} as any);

  const base = {
    targetApps: [], targetCountries: [], targetTiers: [],
  } as any;

  it('filtre vide → match tout le monde', () => {
    expect(svc.matchesUser(base, { app: 'passenger', country: 'CM', tier: 'gold' })).toBe(true);
  });

  it('targetApps=[driver] → ne match pas un passager', () => {
    expect(svc.matchesUser({ ...base, targetApps: ['driver'] }, { app: 'passenger', country: 'CM', tier: 'gold' })).toBe(false);
  });

  it('targetCountries=[CM] → ne match pas TD', () => {
    expect(svc.matchesUser({ ...base, targetCountries: ['CM'] }, { app: 'passenger', country: 'TD', tier: null })).toBe(false);
  });

  it('targetTiers=[gold] ignoré pour app chauffeur', () => {
    expect(svc.matchesUser({ ...base, targetTiers: ['gold'] }, { app: 'driver', country: 'CM', tier: null })).toBe(false);
  });

  it('targetTiers=[gold] → match passager gold', () => {
    expect(svc.matchesUser({ ...base, targetTiers: ['gold'] }, { app: 'passenger', country: 'CM', tier: 'gold' })).toBe(true);
  });
});
