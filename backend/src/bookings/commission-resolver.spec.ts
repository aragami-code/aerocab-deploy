import { resolveCommissionRate } from './commission-resolver';

describe('resolveCommissionRate (cascade)', () => {
  it('priorité au forfait', () => {
    expect(resolveCommissionRate({ forfaitPercent: 20, vehicleRate: 0.12, settingRate: 0.18, tariffsRate: 0.15 })).toBeCloseTo(0.20);
  });
  it('puis taux véhicule', () => {
    expect(resolveCommissionRate({ forfaitPercent: null, vehicleRate: 0.12, settingRate: 0.18, tariffsRate: 0.15 })).toBeCloseTo(0.12);
  });
  it('puis setting pays', () => {
    expect(resolveCommissionRate({ forfaitPercent: null, vehicleRate: null, settingRate: 0.18, tariffsRate: 0.15 })).toBeCloseTo(0.18);
  });
  it('puis tariffs', () => {
    expect(resolveCommissionRate({ forfaitPercent: null, vehicleRate: null, settingRate: null, tariffsRate: 0.15 })).toBeCloseTo(0.15);
  });
  it('défaut 0.15 si tout absent', () => {
    expect(resolveCommissionRate({ forfaitPercent: null, vehicleRate: null, settingRate: null, tariffsRate: null })).toBeCloseTo(0.15);
  });
});
