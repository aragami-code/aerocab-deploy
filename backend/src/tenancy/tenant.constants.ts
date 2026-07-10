export const ZERO_TENANT_ID = 'aerogo';

/**
 * Modèles Prisma (PascalCase) soumis à l'isolation par tenantId.
 * NB : AppSetting est EXCLU (géré par la cascade tenant-aware, pas par le filtre).
 * Partagés plateforme exclus : Country, Airport, Permission, AdminRole, RolePermission.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'User', 'DriverProfile', 'DriverDocument', 'CountryChangeRequest', 'Flight',
  'Booking', 'BookingParticipant', 'BookingPayout', 'PaymentIntent', 'PaymentLink',
  'TipTransaction', 'RideReceipt', 'ReceiptJob', 'DriverRegistrationPayment',
  'DriverEarningsWallet', 'Wallet', 'Transaction', 'WithdrawalRequest', 'PromoCode',
  'PromoUsage', 'Forfait', 'PricingZone', 'DriverPosition', 'PointsTransaction',
  'Rating', 'Report', 'TicketMessage', 'Conversation', 'Message', 'Announcement',
  'AnnouncementRead', 'KycDocument', 'EmergencyContact', 'AdminNotification',
  'FavoriteDriver', 'TariffSnapshot', 'AuditLog', 'UserAdminRole', 'UserPermission',
]);
