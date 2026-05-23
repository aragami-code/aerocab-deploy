"use strict";
/**
 * Mapping préfixe téléphonique E.164 → code pays ISO 3166-1 alpha-2.
 * Utilisé pour auto-détecter le pays depuis un numéro de téléphone.
 * Les préfixes sont triés du plus long au plus court (longest-prefix match).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHONE_PREFIX_MAP = void 0;
exports.extractCountryFromPhone = extractCountryFromPhone;
exports.PHONE_PREFIX_MAP = {
    // Afrique Centrale (CEMAC — XAF)
    '+237': 'CM', // Cameroun
    '+235': 'TD', // Tchad
    '+236': 'CF', // République Centrafricaine
    '+242': 'CG', // Congo-Brazzaville
    '+241': 'GA', // Gabon
    '+240': 'GQ', // Guinée Équatoriale
    // Afrique de l'Ouest (UEMOA — XOF)
    '+221': 'SN', // Sénégal
    '+225': 'CI', // Côte d'Ivoire
    '+223': 'ML', // Mali
    '+226': 'BF', // Burkina Faso
    '+229': 'BJ', // Bénin
    '+228': 'TG', // Togo
    '+227': 'NE', // Niger
    '+245': 'GW', // Guinée-Bissau
    // Autres Afrique
    '+234': 'NG', // Nigeria
    '+233': 'GH', // Ghana
    '+254': 'KE', // Kenya
    '+255': 'TZ', // Tanzanie
    '+256': 'UG', // Ouganda
    '+27': 'ZA', // Afrique du Sud
    '+224': 'GN', // Guinée
    // Afrique du Nord
    '+212': 'MA', // Maroc
    '+213': 'DZ', // Algérie
    '+216': 'TN', // Tunisie
    '+20': 'EG', // Égypte
    // Europe
    '+33': 'FR', // France
    '+32': 'BE', // Belgique
    '+49': 'DE', // Allemagne
    '+39': 'IT', // Italie
    '+34': 'ES', // Espagne
    '+31': 'NL', // Pays-Bas
    '+351': 'PT', // Portugal
    '+44': 'GB', // Royaume-Uni
    '+41': 'CH', // Suisse
    // Amérique du Nord
    '+1': 'US', // États-Unis / Canada (US par défaut)
    // Asie
    '+86': 'CN', // Chine
};
// Préfixes triés du plus long au plus court pour le matching
const SORTED_PREFIXES = Object.keys(exports.PHONE_PREFIX_MAP)
    .sort((a, b) => b.length - a.length);
/**
 * Extrait le code pays ISO depuis un numéro E.164.
 * Ex: '+237612345678' → 'CM', '+33612345678' → 'FR'
 * Retourne null si le préfixe est inconnu.
 */
function extractCountryFromPhone(phone) {
    if (!(phone === null || phone === void 0 ? void 0 : phone.startsWith('+')))
        return null;
    for (const prefix of SORTED_PREFIXES) {
        if (phone.startsWith(prefix))
            return exports.PHONE_PREFIX_MAP[prefix];
    }
    return null;
}
//# sourceMappingURL=phone-country.js.map