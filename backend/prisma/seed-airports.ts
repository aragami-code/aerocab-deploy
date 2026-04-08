import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding airports...');

  const airports = [
    // --- CAMEROUN (Précision maximale) ---
    { iataCode: 'DLA', icaoCode: 'FKKD', name: 'Aéroport international de Douala', city: 'Douala', country: 'Cameroun', countryCode: 'CM', latitude: 4.006086, longitude: 9.719483 },
    { iataCode: 'NSI', icaoCode: 'FKYS', name: 'Aéroport international de Yaoundé-Nsimalen', city: 'Yaoundé', country: 'Cameroun', countryCode: 'CM', latitude: 3.722511, longitude: 11.553258 },
    { iataCode: 'GOU', icaoCode: 'FKKR', name: 'Aéroport international de Garoua', city: 'Garoua', country: 'Cameroun', countryCode: 'CM', latitude: 9.337000, longitude: 13.368000 },
    { iataCode: 'MVR', icaoCode: 'FKLS', name: 'Aéroport de Maroua-Salak', city: 'Maroua', country: 'Cameroun', countryCode: 'CM', latitude: 10.451000, longitude: 14.258000 },
    { iataCode: 'NGE', icaoCode: 'FKKN', name: 'Aéroport de Ngaoundéré', city: 'Ngaoundéré', country: 'Cameroun', countryCode: 'CM', latitude: 7.357000, longitude: 13.558000 },
    { iataCode: 'BPC', icaoCode: 'FKKV', name: 'Aéroport de Bamenda', city: 'Bamenda', country: 'Cameroun', countryCode: 'CM', latitude: 6.039000, longitude: 10.123000 },
    { iataCode: 'BFX', icaoCode: 'FKKW', name: 'Aéroport de Bafoussam', city: 'Bafoussam', country: 'Cameroun', countryCode: 'CM', latitude: 5.537000, longitude: 10.354000 },
    { iataCode: 'BTA', icaoCode: 'FKKO', name: 'Aéroport de Bertoua', city: 'Bertoua', country: 'Cameroun', countryCode: 'CM', latitude: 4.549000, longitude: 13.726000 },

    // --- AFRIQUE (Hubs Majeurs) ---
    { iataCode: 'ABJ', icaoCode: 'DIAP', name: 'Aéroport Félix-Houphouët-Boigny', city: 'Abidjan', country: 'Côte d’Ivoire', countryCode: 'CI', latitude: 5.2614, longitude: -3.9263 },
    { iataCode: 'DSS', icaoCode: 'GOBD', name: 'Aéroport Blaise-Diagne', city: 'Dakar', country: 'Sénégal', countryCode: 'SN', latitude: 14.6711, longitude: -17.0672 },
    { iataCode: 'ACC', icaoCode: 'DGAA', name: 'Kotoka International Airport', city: 'Accra', country: 'Ghana', countryCode: 'GH', latitude: 5.6051, longitude: -0.1667 },
    { iataCode: 'LOS', icaoCode: 'DNMM', name: 'Murtala Muhammed International Airport', city: 'Lagos', country: 'Nigéria', countryCode: 'NG', latitude: 6.5774, longitude: 3.3210 },
    { iataCode: 'ADD', icaoCode: 'HAAB', name: 'Bole International Airport', city: 'Addis Ababa', country: 'Éthiopie', countryCode: 'ET', latitude: 8.9778, longitude: 38.7993 },
    { iataCode: 'NBO', icaoCode: 'HKJK', name: 'Jomo Kenyatta International Airport', city: 'Nairobi', country: 'Kenya', countryCode: 'KE', latitude: -1.3192, longitude: 36.9275 },
    { iataCode: 'JNB', icaoCode: 'FAOR', name: 'OR Tambo International Airport', city: 'Johannesburg', country: 'Afrique du Sud', countryCode: 'ZA', latitude: -26.1367, longitude: 28.2460 },
    { iataCode: 'CMN', icaoCode: 'GMMN', name: 'Aéroport Mohammed V', city: 'Casablanca', country: 'Maroc', countryCode: 'MA', latitude: 33.3675, longitude: -7.5897 },
    { iataCode: 'CAI', icaoCode: 'HECA', name: 'Cairo International Airport', city: 'Le Caire', country: 'Égypte', countryCode: 'EG', latitude: 30.1219, longitude: 31.4056 },

    // --- EUROPE (Hubs Majeurs) ---
    { iataCode: 'CDG', icaoCode: 'LFPG', name: 'Aéroport Paris-Charles de Gaulle', city: 'Paris', country: 'France', countryCode: 'FR', latitude: 49.0097, longitude: 2.5479 },
    { iataCode: 'ORY', icaoCode: 'LFPO', name: 'Aéroport de Paris-Orly', city: 'Paris', country: 'France', countryCode: 'FR', latitude: 48.7262, longitude: 2.3652 },
    { iataCode: 'BRU', icaoCode: 'EBBR', name: 'Brussels Airport', city: 'Bruxelles', country: 'Belgique', countryCode: 'BE', latitude: 50.9010, longitude: 4.4844 },
    { iataCode: 'ZRH', icaoCode: 'LSZH', name: 'Zurich Airport', city: 'Zurich', country: 'Suisse', countryCode: 'CH', latitude: 47.4582, longitude: 8.5481 },
    { iataCode: 'FRA', icaoCode: 'EDDF', name: 'Frankfurt Airport', city: 'Francfort', country: 'Allemagne', countryCode: 'DE', latitude: 50.0379, longitude: 8.5622 },
    { iataCode: 'LHR', icaoCode: 'EGLL', name: 'London Heathrow Airport', city: 'Londres', country: 'Royaume-Uni', countryCode: 'GB', latitude: 51.4700, longitude: -0.4543 },
    { iataCode: 'AMS', icaoCode: 'EHAM', name: 'Amsterdam Airport Schiphol', city: 'Amsterdam', country: 'Pays-Bas', countryCode: 'NL', latitude: 52.3105, longitude: 4.7683 },
    { iataCode: 'MAD', icaoCode: 'LEMD', name: 'Adolfo Suárez Madrid-Barajas', city: 'Madrid', country: 'Espagne', countryCode: 'ES', latitude: 40.4719, longitude: -3.5626 },
    { iataCode: 'IST', icaoCode: 'LTFM', name: 'Istanbul Airport', city: 'Istanbul', country: 'Turquie', countryCode: 'TR', latitude: 41.2753, longitude: 28.7519 },
    { iataCode: 'GVA', icaoCode: 'LSGG', name: 'Geneva Airport', city: 'Genève', country: 'Suisse', countryCode: 'CH', latitude: 46.2381, longitude: 6.1089 },

    // --- MOYEN-ORIENT & ASIE ---
    { iataCode: 'DXB', icaoCode: 'OMDB', name: 'Dubai International Airport', city: 'Dubaï', country: 'Émirats Arabes Unis', countryCode: 'AE', latitude: 25.2532, longitude: 55.3657 },
    { iataCode: 'DOH', icaoCode: 'OTHH', name: 'Hamad International Airport', city: 'Doha', country: 'Qatar', countryCode: 'QA', latitude: 25.2731, longitude: 51.6081 },
    { iataCode: 'JED', icaoCode: 'OEJN', name: 'King Abdulaziz International Airport', city: 'Djeddah', country: 'Arabie Saoudite', countryCode: 'SA', latitude: 21.6796, longitude: 39.1565 },
    { iataCode: 'CAN', icaoCode: 'ZGGG', name: 'Guangzhou Baiyun International Airport', city: 'Canton', country: 'Chine', countryCode: 'CN', latitude: 23.3924, longitude: 113.2988 },

    // --- AMÉRIQUES ---
    { iataCode: 'JFK', icaoCode: 'KJFK', name: 'John F. Kennedy International Airport', city: 'New York', country: 'États-Unis', countryCode: 'US', latitude: 40.6413, longitude: -73.7781 },
    { iataCode: 'IAD', icaoCode: 'KIAD', name: 'Washington Dulles International Airport', city: 'Washington', country: 'États-Unis', countryCode: 'US', latitude: 38.9445, longitude: -77.4558 },
    { iataCode: 'YUL', icaoCode: 'CYUL', name: 'Montréal-Trudeau International Airport', city: 'Montréal', country: 'Canada', countryCode: 'CA', latitude: 45.4657, longitude: -73.7455 },
    { iataCode: 'GRU', icaoCode: 'SBGR', name: 'São Paulo/Guarulhos Airport', city: 'São Paulo', country: 'Brésil', countryCode: 'BR', latitude: -23.4356, longitude: -46.4731 },
  ];

  for (const airport of airports) {
    await prisma.airport.upsert({
      where: { iataCode: airport.iataCode },
      update: airport,
      create: airport,
    });
    console.log(`- Airport ${airport.iataCode} seeded.`);
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
