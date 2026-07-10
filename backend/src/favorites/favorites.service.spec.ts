import { FavoritesService } from './favorites.service';

describe('FavoritesService', () => {
  it('toggle ajoute puis retire (idempotent unique), résout l\'id profil', async () => {
    const prisma = {
      driverProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'd1' }) },
      favoriteDriver: {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'f1' }),
        create: jest.fn().mockResolvedValue({ id: 'f1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const svc = new FavoritesService(prisma);
    expect(await svc.toggle('p1', 'd1')).toEqual({ favorited: true });
    expect(prisma.favoriteDriver.create).toHaveBeenCalledWith({ data: { passengerId: 'p1', driverId: 'd1' } });
    expect(await svc.toggle('p1', 'd1')).toEqual({ favorited: false });
    expect(prisma.favoriteDriver.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
  });

  it('toggle résout un userId chauffeur en profileId', async () => {
    const prisma = {
      driverProfile: { findUnique: jest.fn()
        .mockResolvedValueOnce(null)            // pas trouvé par id
        .mockResolvedValueOnce({ id: 'prof-9' }) // trouvé par userId
      },
      favoriteDriver: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'f9' }) },
    } as any;
    const svc = new FavoritesService(prisma);
    expect(await svc.toggle('p1', 'user-9')).toEqual({ favorited: true });
    expect(prisma.favoriteDriver.create).toHaveBeenCalledWith({ data: { passengerId: 'p1', driverId: 'prof-9' } });
  });

  it('driverIds renvoie les IDs des favoris', async () => {
    const prisma = {
      favoriteDriver: { findMany: jest.fn().mockResolvedValue([{ driverId: 'd1' }, { driverId: 'd2' }]) },
    } as any;
    const svc = new FavoritesService(prisma);
    expect(await svc.driverIds('p1')).toEqual(['d1', 'd2']);
  });

  it('isFavorite vrai si la ligne existe', async () => {
    const prisma = {
      driverProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'd1' }) },
      favoriteDriver: { findUnique: jest.fn().mockResolvedValue({ id: 'f1' }) },
    } as any;
    const svc = new FavoritesService(prisma);
    expect(await svc.isFavorite('p1', 'd1')).toBe(true);
  });
});
