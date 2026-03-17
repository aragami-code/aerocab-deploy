// ===== AeroCab Brand Colors =====
export const COLORS = {
  primary: '#1D2C4D',
  primaryLight: '#2A4070',
  primaryDark: '#141E35',
  accent: '#FAB81F',
  accentLight: '#FDD66B',
  black: '#191817',
  grayDark: '#4A4A4A',
  grayMedium: '#9B9B9B',
  grayLight: '#E8E8E8',
  background: '#F7F8FA',
  white: '#FFFFFF',
  success: '#27AE60',
  error: '#E74C3C',
  warning: '#F39C12',
} as const;

// ===== Airports =====
export const AIRPORTS = {
  DLA: {
    code: 'DLA',
    name: 'Douala International Airport',
    city: 'Douala',
    lat: 4.0061,
    lng: 9.7194,
  },
  NSI: {
    code: 'NSI',
    name: 'Yaounde Nsimalen International Airport',
    city: 'Yaounde',
    lat: 3.7226,
    lng: 11.5533,
  },
} as const;

// ===== Business Constants =====
export const ACCESS_PRICE = 2500;
export const ACCESS_CURRENCY = 'XAF';
export const ACCESS_DURATION_HOURS = 48;

// ===== Auth Constants =====
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_COOLDOWN_MINUTES = 10;
export const JWT_EXPIRY_DAYS = 30;

// ===== Rating Constants =====
export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const RATING_MIN_REVIEWS_TO_SHOW = 3;
export const RATING_COMMENT_MAX_LENGTH = 200;

// ===== Driver Location =====
export const DRIVER_LOCATION_UPDATE_INTERVAL_MS = 30_000;

// ===== UI Constants =====
export const BORDER_RADIUS = {
  button: 12,
  card: 16,
  bottomSheet: 24,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const MIN_TOUCH_TARGET = 44;

// ===== Supported Languages =====
export const SUPPORTED_LANGUAGES = ['fr', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// ===== Payment Methods =====
export const PAYMENT_METHODS = ['orange_money', 'mtn_momo'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ===== Document Types =====
export const REQUIRED_DRIVER_DOCUMENTS = [
  'cni_front',
  'cni_back',
  'license',
  'registration',
  'vehicle_photo',
] as const;

// ===== Default Country (Cameroun) =====
export const DEFAULT_COUNTRY = {
  code: 'CM',
  name: 'Cameroun',
  currency: ACCESS_CURRENCY,
  accessPrice: ACCESS_PRICE,
  accessDurationHours: ACCESS_DURATION_HOURS,
  paymentMethods: [...PAYMENT_METHODS],
  airports: [AIRPORTS.DLA, AIRPORTS.NSI],
  isActive: true,
} as const;
