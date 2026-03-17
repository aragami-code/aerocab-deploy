import { z } from 'zod';
import {
  OTP_LENGTH,
  RATING_MIN,
  RATING_MAX,
  RATING_COMMENT_MAX_LENGTH,
  SUPPORTED_LANGUAGES,
  PAYMENT_METHODS,
  REQUIRED_DRIVER_DOCUMENTS,
} from '../constants';

// ===== Phone =====
export const phoneSchema = z
  .string()
  .regex(/^\+?[0-9]{9,15}$/, 'Numéro de téléphone invalide');

// ===== OTP =====
export const otpSchema = z
  .string()
  .length(OTP_LENGTH, `Le code OTP doit contenir ${OTP_LENGTH} chiffres`)
  .regex(/^[0-9]+$/, 'Le code OTP ne doit contenir que des chiffres');

// ===== Auth =====
export const sendOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: otpSchema,
});

// ===== User Profile =====
export const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
});

// ===== Flight =====
export const flightNumberSchema = z
  .string()
  .regex(/^[A-Z0-9]{2,3}\s?\d{1,4}$/, 'Numéro de vol invalide (ex: AF123)');

export const createFlightSchema = z.object({
  flightNumber: flightNumberSchema.optional(),
  airline: z.string().max(100).optional(),
  arrivalAirport: z.string().length(3),
  scheduledArrival: z.coerce.date(),
});

// ===== Access Pass =====
export const purchaseAccessSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS),
});

// ===== Driver Registration =====
export const driverRegisterSchema = z.object({
  vehicleBrand: z.string().min(1).max(50),
  vehicleModel: z.string().min(1).max(50),
  vehicleColor: z.string().min(1).max(30),
  vehiclePlate: z.string().min(1).max(20),
  languages: z.array(z.enum(SUPPORTED_LANGUAGES)).min(1),
});

// ===== Driver Location =====
export const driverLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// ===== Rating =====
export const createRatingSchema = z.object({
  conversationId: z.string().uuid(),
  score: z.number().int().min(RATING_MIN).max(RATING_MAX),
  comment: z.string().max(RATING_COMMENT_MAX_LENGTH).optional(),
});

// ===== Report =====
export const createReportSchema = z.object({
  reportedId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  reason: z.string().min(10).max(500),
});

// ===== Chat Message =====
export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(1000),
});

// ===== Document Type =====
export const documentTypeSchema = z.enum(REQUIRED_DRIVER_DOCUMENTS);
