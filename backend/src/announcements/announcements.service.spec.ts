import { AnnouncementsService } from './announcements.service';

describe('AnnouncementsService.matchesUser (filtrage)', () => {
  const svc = new AnnouncementsService({} as any, {} as any, {} as any, {} as any);

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

describe('AnnouncementsService.create — notification push', () => {
  function setup(created: any) {
    const prisma = {
      announcement: { create: jest.fn().mockResolvedValue(created) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
    } as any;
    const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new AnnouncementsService(prisma, {} as any, {} as any, notifications);
    return { svc, prisma, notifications };
  }

  it('annonce live → notifie les utilisateurs ciblés', async () => {
    const created = { id: 'a1', title: 'T', body: 'B', isActive: true, startsAt: null, endsAt: null, targetApps: [], targetCountries: [], targetTiers: [] };
    const { svc, notifications } = setup(created);
    await svc.create({ title: 'T', body: 'B' }, 'admin-1');
    await new Promise((r) => setImmediate(r)); // laisse le push non-bloquant se résoudre
    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
    expect(notifications.sendToUser).toHaveBeenCalledWith('u1', 'T', 'B', { type: 'announcement', announcementId: 'a1' });
  });

  it('annonce programmée dans le futur → AUCUN push à la création', async () => {
    const future = new Date(Date.now() + 3600e3);
    const created = { id: 'a2', title: 'T', body: 'B', isActive: true, startsAt: future, endsAt: null, targetApps: [], targetCountries: [], targetTiers: [] };
    const { svc, notifications } = setup(created);
    await svc.create({ title: 'T', body: 'B', startsAt: future.toISOString() }, 'admin-1');
    await new Promise((r) => setImmediate(r));
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });
});
