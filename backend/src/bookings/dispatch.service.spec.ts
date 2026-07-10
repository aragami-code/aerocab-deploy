import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from './dispatch.service';
import { PrismaService } from '../database/prisma.service';
import { AirportsService } from '../airports/airports.service';
import { SettingsService } from '../settings/settings.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { FavoritesService } from '../favorites/favorites.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const driverHighRated  = { id: 'd1', ratingAvg: 4.9, score: 4.8, isAvailable: true, userId: 'u1' };
const driverMidRated   = { id: 'd2', ratingAvg: 4.5, score: 4.5, isAvailable: true, userId: 'u2' };
const driverLowRated   = { id: 'd3', ratingAvg: 3.9, score: 4.0, isAvailable: true, userId: 'u3' };

const mockPrisma = {
  driverProfile: {
    findMany: jest.fn(),
    $queryRaw: jest.fn(),
  },
  $queryRaw: jest.fn().mockResolvedValue([]),
};

const mockAirports = {
  findByCode: jest.fn().mockResolvedValue({ latitude: 3.72, longitude: 11.51 }),
};

const mockSettings = {
  getForCountry: jest.fn().mockResolvedValue('4.0'),
  get: jest.fn().mockResolvedValue('25'),
};

const mockLoyalty = {
  resolveAvailability: jest.fn(),
  topRatedMinRating: jest.fn().mockResolvedValue(4.8),
};

const mockFavorites = {
  driverIds: jest.fn().mockResolvedValue([]),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('DispatchService', () => {
  let service: DispatchService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: no top_rated active
    mockLoyalty.resolveAvailability.mockResolvedValue({
      categories: [],
      services: [
        { key: 'priority',   included: false, cost: 50  },
        { key: 'top_rated',  included: false, cost: 150 },
        { key: 'guaranteed', included: false, cost: 200 },
      ],
    });

    // Default settings: minScore 4.0, preLandingLimit 50, radius 25
    mockSettings.getForCountry.mockResolvedValue('4.0');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService,    useValue: mockPrisma    },
        { provide: AirportsService,  useValue: mockAirports  },
        { provide: SettingsService,  useValue: mockSettings  },
        { provide: LoyaltyService,   useValue: mockLoyalty   },
        { provide: FavoritesService, useValue: mockFavorites },
      ],
    }).compile();

    service = module.get<DispatchService>(DispatchService);
  });

  // ── Task 12 — filtre top-rated ──────────────────────────────────────────────

  describe('filtre top-rated', () => {
    it('filtre les chauffeurs sous le seuil top-rated quand le perk est payé', async () => {
      mockPrisma.driverProfile.findMany.mockResolvedValue([
        driverHighRated, driverMidRated, driverLowRated,
      ]);

      const drivers = await service.findEligibleDrivers(
        { purchasedPerks: ['top_rated'], operatingCountry: 'CM', vehicleType: 'standard', departureAirport: 'DLA' } as any,
        true, // isPreLanding = true → prend le chemin findMany direct
        undefined,
        'platinum',
      );

      // Seuls les chauffeurs avec ratingAvg >= 4.8 doivent être retournés
      expect(drivers.every((d: any) => (d.ratingAvg ?? 0) >= 4.8)).toBe(true);
      expect(drivers.some((d: any) => d.id === 'd1')).toBe(true);
      expect(drivers.some((d: any) => d.id === 'd2')).toBe(false);
      expect(drivers.some((d: any) => d.id === 'd3')).toBe(false);
    });

    it('filtre via top_rated inclus par le niveau (platinum)', async () => {
      // Platinum inclut top_rated via la matrice
      mockLoyalty.resolveAvailability.mockResolvedValue({
        categories: [],
        services: [
          { key: 'priority',   included: true,  cost: 0   },
          { key: 'top_rated',  included: true,  cost: 0   },
          { key: 'guaranteed', included: true,  cost: 0   },
        ],
      });

      mockPrisma.driverProfile.findMany.mockResolvedValue([
        driverHighRated, driverMidRated,
      ]);

      const drivers = await service.findEligibleDrivers(
        { purchasedPerks: [], operatingCountry: 'CM', vehicleType: 'standard', effectiveTier: 'platinum', departureAirport: 'DLA' } as any,
        true,
        undefined,
        'platinum',
      );

      expect(drivers.every((d: any) => (d.ratingAvg ?? 0) >= 4.8)).toBe(true);
    });

    it('repli : si aucun chauffeur ne passe le filtre, retourne tous les chauffeurs (ne jamais bloquer)', async () => {
      // Tous les chauffeurs sont sous le seuil
      const allLow = [driverMidRated, driverLowRated];
      mockPrisma.driverProfile.findMany.mockResolvedValue(allLow);

      const drivers = await service.findEligibleDrivers(
        { purchasedPerks: ['top_rated'], operatingCountry: 'CM', vehicleType: 'standard', departureAirport: 'DLA' } as any,
        true,
        undefined,
        'bronze',
      );

      // Repli → liste complète non filtrée
      expect(drivers).toEqual(allLow);
    });

    it('ne filtre pas si top_rated non actif (ni payé ni inclus)', async () => {
      const allDrivers = [driverHighRated, driverMidRated, driverLowRated];
      mockPrisma.driverProfile.findMany.mockResolvedValue(allDrivers);

      const drivers = await service.findEligibleDrivers(
        { purchasedPerks: [], operatingCountry: 'CM', vehicleType: 'standard', departureAirport: 'DLA' } as any,
        true,
        undefined,
        'bronze',
      );

      // Pas de filtre → tous retournés
      expect(drivers).toEqual(allDrivers);
      expect(mockLoyalty.topRatedMinRating).not.toHaveBeenCalled();
    });
  });

  // ── Task 4.2 — chauffeur favori (attente courte) ────────────────────────────

  describe('biais chauffeur favori', () => {
    it('preferFavorite : restreint aux favoris éligibles présents', async () => {
      mockFavorites.driverIds.mockResolvedValue(['d2']);
      mockPrisma.driverProfile.findMany.mockResolvedValue([driverHighRated, driverMidRated, driverLowRated]);

      const drivers = await service.findEligibleDrivers(
        { passengerId: 'p1', preferFavorite: true, operatingCountry: 'CM', vehicleType: 'standard', departureAirport: 'DLA', purchasedPerks: [] } as any,
        true, undefined, 'bronze',
      );

      expect(drivers.map((d: any) => d.id)).toEqual(['d2']);
    });

    it('preferFavorite : aucun favori éligible → liste complète (repli)', async () => {
      mockFavorites.driverIds.mockResolvedValue(['d-absent']);
      const all = [driverHighRated, driverMidRated];
      mockPrisma.driverProfile.findMany.mockResolvedValue(all);

      const drivers = await service.findEligibleDrivers(
        { passengerId: 'p1', preferFavorite: true, operatingCountry: 'CM', vehicleType: 'standard', departureAirport: 'DLA', purchasedPerks: [] } as any,
        true, undefined, 'bronze',
      );

      expect(drivers).toEqual(all);
    });

    it('sans preferFavorite : pas de restriction favori', async () => {
      mockFavorites.driverIds.mockResolvedValue(['d1']);
      const all = [driverHighRated, driverMidRated];
      mockPrisma.driverProfile.findMany.mockResolvedValue(all);

      const drivers = await service.findEligibleDrivers(
        { passengerId: 'p1', operatingCountry: 'CM', vehicleType: 'standard', departureAirport: 'DLA', purchasedPerks: [] } as any,
        true, undefined, 'bronze',
      );

      expect(drivers).toEqual(all);
      expect(mockFavorites.driverIds).not.toHaveBeenCalled();
    });
  });
});
