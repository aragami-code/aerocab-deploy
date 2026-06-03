import { pickCredential } from './cred-resolver';

describe('pickCredential', () => {
  it('valeur DB pays prioritaire', () => {
    expect(pickCredential('sk_sn', 'sk_global', 'sk_env')).toBe('sk_sn');
  });
  it('valeur DB globale si pas de pays', () => {
    expect(pickCredential('', 'sk_global', 'sk_env')).toBe('sk_global');
  });
  it('env si rien en DB', () => {
    expect(pickCredential('', '', 'sk_env')).toBe('sk_env');
  });
  it('chaîne vide si tout absent', () => {
    expect(pickCredential('', '', '')).toBe('');
  });
});
