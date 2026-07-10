export type Channel = 'sms' | 'whatsapp' | 'email';

export interface ChannelContext {
  hasPhone: boolean;
  hasEmail: boolean;
  mode: 'login' | 'link';
}

/**
 * Canaux candidats selon les contacts du compte, puis intersection avec les
 * canaux activés du pays. En mode 'link' (liaison de numéro), l'email est exclu
 * car il ne prouve pas la possession du numéro.
 */
export function availableChannels(ctx: ChannelContext, enabled: Channel[]): Channel[] {
  const candidates: Channel[] = [];
  if (ctx.hasPhone) { candidates.push('sms', 'whatsapp'); }
  if (ctx.mode !== 'link' && ctx.hasEmail) { candidates.push('email'); }
  return candidates.filter((c) => enabled.includes(c));
}
