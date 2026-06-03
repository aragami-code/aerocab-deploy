/**
 * Choisit la valeur de credential effective :
 * override pays/global (DB, déjà résolu par getForCountry) → valeur globale → env → ''.
 * Fonction pure pour testabilité.
 */
export function pickCredential(dbCountryOrGlobal: string, dbGlobal: string, envValue: string): string {
  return dbCountryOrGlobal || dbGlobal || envValue;
}
