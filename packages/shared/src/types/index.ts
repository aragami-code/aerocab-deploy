// ===== User Types =====
export type UserRole = 'passenger' | 'driver' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'pending';

export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

// ===== Driver Types =====
export type DriverVerificationStatus = 'pending' | 'approved' | 'rejected';

export interface DriverProfile {
  id: string;
  userId: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleColor: string;
  vehiclePlate: string;
  languages: string[];
  isAvailable: boolean;
  latitude: number | null;
  longitude: number | null;
  locationUpdatedAt: Date | null;
  verificationStatus: DriverVerificationStatus;
  rejectionReason: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentType =
  | 'cni_front'
  | 'cni_back'
  | 'license'
  | 'registration'
  | 'vehicle_photo';

export interface DriverDocument {
  id: string;
  driverId: string;
  type: DocumentType;
  fileUrl: string;
  uploadedAt: Date;
}

// ===== Flight Types =====
export type FlightSource = 'api' | 'manual';

export interface Flight {
  id: string;
  userId: string;
  flightNumber: string | null;
  airline: string | null;
  arrivalAirport: string;
  scheduledArrival: Date;
  actualArrival: Date | null;
  source: FlightSource;
  createdAt: Date;
}

// ===== Access Pass Types =====
export type AccessPassStatus = 'pending' | 'active' | 'expired' | 'failed';

export interface AccessPass {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  paymentRef: string | null;
  status: AccessPassStatus;
  activatedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

// ===== Chat Types =====
export interface Conversation {
  id: string;
  passengerId: string;
  driverId: string;
  flightId: string | null;
  createdAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

// ===== Rating Types =====
export interface Rating {
  id: string;
  conversationId: string;
  raterId: string;
  ratedId: string;
  score: number;
  comment: string | null;
  createdAt: Date;
}

// ===== Report Types =====
export type ReportStatus = 'open' | 'in_progress' | 'resolved';

export interface Report {
  id: string;
  reporterId: string;
  reportedId: string;
  conversationId: string | null;
  reason: string;
  status: ReportStatus;
  adminNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

// ===== Country / Config Types =====
export interface Airport {
  code: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}

export interface Country {
  id: string;
  code: string;
  name: string;
  currency: string;
  accessPrice: number;
  accessDurationHours: number;
  airports: Airport[];
  paymentMethods: string[];
  isActive: boolean;
}
