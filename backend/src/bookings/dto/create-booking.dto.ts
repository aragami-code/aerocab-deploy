import { IsString, IsNumber, IsOptional, IsIn, IsNotEmpty, IsBoolean, Min, Max, Matches, Length } from 'class-validator';

const VALID_PAYMENT_METHODS = ['cash', 'card', 'points', 'orange_money_cm', 'mtn_cm', 'wallet', 'orange_money', 'mtn_momo'];

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
  @IsNumber()
  roadDistanceKm?: number;

  @IsOptional()
  @IsString()
  promoCode?: string;

  /**
   * Le passager accepte explicitement un délai de prise en charge plus long
   * (cas où aucun chauffeur n'est dans le rayon de proximité immédiate).
   * Envoyé après réception d'une réponse 400 { code: 'DELAYED_DISPATCH', estimatedWaitMin }.
   * Le client doit afficher le délai au passager avant de re-POSTER avec ce flag.
   */
  @IsOptional()
  @IsBoolean()
  acceptDelay?: boolean;

  // ── Verrou de prix ───────────────────────────────────────────────────────────
  @IsOptional()
  @IsNumber()
  expectedPriceFcfa?: number; // Prix affiché au passager — vérifié côté backend avant création

  @IsOptional()
  @IsString()
  forfaitId?: string; // UUID du forfait sélectionné par le passager

  /**
   * Code pays ISO-3166-1 alpha-2 (ex: 'CM', 'NG'). Utilisé principalement pour
   * les bookings INTERNATIONAL sans aéroport de départ — le pays est alors
   * extrait du DTO au lieu de l'aéroport.
   */
  @IsOptional()
  @IsString()
  @Length(2, 2, { message: 'countryCode doit faire 2 caractères ISO-3166-1' })
  @Matches(/^[a-zA-Z]{2}$/, { message: 'countryCode doit contenir uniquement des lettres' })
  countryCode?: string;

  // ── Réservation programmée ───────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  scheduledAt?: string; // ISO 8601, minimum 30 min dans le futur

  // ── Devise d'affichage (multi-pays) ──────────────────────────────────────────
  @IsOptional()
  @IsString()
  displayCurrency?: string; // Devise vue par le passager (ex: EUR, MAD, XAF)

  @IsOptional()
  @IsNumber()
  displayAmount?: number; // Montant converti affiché (ex: 22.90 pour 15000 XAF en EUR)

  @IsOptional()
  @IsNumber()
  exchangeRateUsed?: number; // Taux XAF→displayCurrency utilisé pour l'affichage

  @IsOptional()
  @IsNumber()
  pointsUsed?: number; // Points fidélité utilisés en déduction
}
