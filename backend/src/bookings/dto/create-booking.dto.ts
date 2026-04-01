import { IsString, IsNumber, IsOptional, IsIn, IsNotEmpty, IsBoolean, Min, Max } from 'class-validator';

const VALID_VEHICLE_TYPES = ['eco', 'eco_plus', 'standard', 'confort', 'confort_plus'];
const VALID_PAYMENT_METHODS = ['cash', 'card', 'points', 'orange_money', 'mtn_momo'];
const VALID_AIRPORTS = ['DLA', 'NSI'];

export class CreateBookingDto {
  @IsString()
  @IsIn(VALID_VEHICLE_TYPES, { message: 'Type de véhicule invalide' })
  vehicleType!: string;

  @IsString()
  @IsIn(VALID_PAYMENT_METHODS, { message: 'Méthode de paiement invalide' })
  paymentMethod!: string;

  @IsString()
  @IsIn(VALID_AIRPORTS, { message: 'Aéroport invalide' })
  departureAirport!: string;

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
  @IsIn(VALID_VEHICLE_TYPES, { message: 'Type de véhicule de consigne invalide' })
  consigneVehicleType?: string; // peut différer du vehicleType principal

  // ── Surcharges contextuelles ─────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  rainSurge?: boolean;    // L'utilisateur signale qu'il pleut
}
