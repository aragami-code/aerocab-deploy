export interface Palette { id: string; name: string; primary: string; accent: string; }

export const PALETTE_CATALOG: Palette[] = [
  { id: 'aerogo',    name: 'AeroGo',        primary: '#C0102E', accent: '#1E1E1E' },
  { id: 'midnight',  name: 'Minuit',        primary: '#1E3A8A', accent: '#38BDF8' },
  { id: 'sunset',    name: 'Coucher',       primary: '#C2410C', accent: '#FDBA74' },
  { id: 'forest',    name: 'Forêt',         primary: '#166534', accent: '#86EFAC' },
  { id: 'royal',     name: 'Royal',         primary: '#6D28D9', accent: '#C4B5FD' },
  { id: 'ocean',     name: 'Océan',         primary: '#0E7490', accent: '#67E8F9' },
  { id: 'rose',      name: 'Rose',          primary: '#BE185D', accent: '#F9A8D4' },
  { id: 'amber',     name: 'Ambre',         primary: '#B45309', accent: '#FCD34D' },
  { id: 'slate',     name: 'Ardoise',       primary: '#334155', accent: '#94A3B8' },
  { id: 'emerald',   name: 'Émeraude',      primary: '#047857', accent: '#6EE7B7' },
  { id: 'indigo',    name: 'Indigo',        primary: '#4338CA', accent: '#A5B4FC' },
  { id: 'crimson',   name: 'Cramoisi',      primary: '#9F1239', accent: '#FDA4AF' },
  { id: 'teal',      name: 'Sarcelle',      primary: '#0F766E', accent: '#5EEAD4' },
  { id: 'violet',    name: 'Violet',        primary: '#7C3AED', accent: '#DDD6FE' },
  { id: 'sky',       name: 'Ciel',          primary: '#0369A1', accent: '#7DD3FC' },
  { id: 'lime',      name: 'Citron vert',   primary: '#4D7C0F', accent: '#BEF264' },
  { id: 'fuchsia',   name: 'Fuchsia',       primary: '#A21CAF', accent: '#F0ABFC' },
  { id: 'graphite',  name: 'Graphite',      primary: '#18181B', accent: '#D4D4D8' },
  { id: 'coral',     name: 'Corail',        primary: '#E11D48', accent: '#FECDD3' },
  { id: 'gold',      name: 'Or',            primary: '#92400E', accent: '#FBBF24' },
];
