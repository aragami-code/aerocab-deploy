import { IsString, IsNumber, IsOptional, IsIn, IsNotEmpty, Min, Max } from 'class-validator';

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
  @IsIn(VALID_AIRPORTS, { message: 'Aéroport de départ invalide' })
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
  @IsIn(['ARRIVAL', 'DEPARTURE'], { message: 'Type de réservation invalide' })
  type?: 'ARRIVAL' | 'DEPARTURE';

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
}
