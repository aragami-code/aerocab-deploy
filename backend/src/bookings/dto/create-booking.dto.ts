import { IsString, IsNumber, IsOptional, IsIn, IsNotEmpty, IsBoolean, Min, Max } from 'class-validator';

const VALID_PAYMENT_METHODS = ['cash', 'card', 'points', 'orange_money', 'mtn_momo', 'wallet'];

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty({ message: 'Le type de véhicule est requis' })
  vehicleType!: string; // Valeur libre — validée dynamiquement contre les tarifs DB

  @IsString()
  @IsIn(VALID_PAYMENT_METHODS, { message: 'Méthode de paiement invalide' })
  paymentMethod!: string;

  @IsOptional()
  @IsString()
  departureAirport?: string;

  @IsString()
  @IsNotEmpty({ message: 'La destination est requise' })
  destination!: string;

  @IsOptional()
  @IsString()
  flightNumber?: string;

  @IsOptional()
  @IsNumber()
  destLat?: number;

  @IsOptional()
  @IsNumber()
  destLng?: number;

  @IsOptional()
  @IsString()
  @IsIn(['ARRIVAL', 'DEPARTURE', 'INTERNATIONAL'], { message: 'Type de réservation invalide' })
  type?: 'ARRIVAL' | 'DEPARTURE' | 'INTERNATIONAL';

  @IsOptional()
  @IsString()
  pickupAddress?: string;

  @IsOptional()
  @IsNumber()
  pickupLat?: number;

  @IsOptional()
  @IsNumber()
  pickupLng?: number;

  @IsOptional()
  @IsString()
  promoCode?: string;

  @IsOptional()
  @IsString()
  force?: string;

  // ── Consigne ────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  withConsigne?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Minimum 1 jour de consigne' })
  @Max(90, { message: 'Maximum 90 jours' })
  consigneDays?: number;

  @IsOptional()
  @IsString()
  consigneVehicleType?: string; // peut différer du vehicleType principal

  // ── Surcharges contextuelles ─────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  rainSurge?: boolean;    // L'utilisateur signale qu'il pleut

  // ── Verrou de prix ───────────────────────────────────────────────────────────
  @IsOptional()
  @IsNumber()
  expectedPriceFcfa?: number; // Prix affiché au passager — vérifié côté backend avant création
}
