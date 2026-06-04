import { availableChannels, Channel } from './otp-channels';

describe('availableChannels', () => {
  const all: Channel[] = ['sms', 'whatsapp', 'email'];

  it('compte avec téléphone seul → sms, whatsapp', () => {
    expect(availableChannels({ hasPhone: true, hasEmail: false, mode: 'login' }, all))
      .toEqual(['sms', 'whatsapp']);
  });
  it('compte avec email seul → email', () => {
    expect(availableChannels({ hasPhone: false, hasEmail: true, mode: 'login' }, all))
      .toEqual(['email']);
  });
  it('compte tél + email → sms, whatsapp, email', () => {
    expect(availableChannels({ hasPhone: true, hasEmail: true, mode: 'login' }, all))
      .toEqual(['sms', 'whatsapp', 'email']);
  });
  it('liaison (mode=link) ignore email même si présent', () => {
    expect(availableChannels({ hasPhone: true, hasEmail: true, mode: 'link' }, all))
      .toEqual(['sms', 'whatsapp']);
  });
  it('intersecte avec les canaux activés du pays', () => {
    expect(availableChannels({ hasPhone: true, hasEmail: true, mode: 'login' }, ['sms', 'email']))
      .toEqual(['sms', 'email']);
  });
  it('aucun canal activé pertinent → tableau vide', () => {
    expect(availableChannels({ hasPhone: false, hasEmail: true, mode: 'login' }, ['sms', 'whatsapp']))
      .toEqual([]);
  });
});
