import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding airports...');

  const airports = [
    {
      iataCode: 'DLA',
      name: 'Aéroport international de Douala',
      city: 'Douala',
      country: 'Cameroun',
      countryCode: 'CM',
      latitude: 4.0061,
      longitude: 9.7194,
    },
    {
      iataCode: 'NSI',
      name: 'Aéroport international de Yaoundé-Nsimalen',
      city: 'Yaoundé',
      country: 'Cameroun',
      countryCode: 'CM',
      latitude: 3.7225,
      longitude: 11.5533,
    },
    {
      iataCode: 'GOU',
      name: 'Aéroport international de Garoua',
      city: 'Garoua',
      country: 'Cameroun',
      countryCode: 'CM',
      latitude: 9.337,
      longitude: 13.368,
    },
    {
      iataCode: 'MVR',
      name: 'Aéroport de Maroua-Salak',
      city: 'Maroua',
      country: 'Cameroun',
      countryCode: 'CM',
      latitude: 10.451,
      longitude: 14.258,
    },
    {
      iataCode: 'NGE',
      name: 'Aéroport de Ngaoundéré',
      city: 'Ngaoundéré',
      country: 'Cameroun',
      countryCode: 'CM',
      latitude: 7.357,
      longitude: 13.558,
    },
    {
      iataCode: 'BPC',
      name: 'Aéroport de Bamenda',
      city: 'Bamenda',
      country: 'Cameroun',
      countryCode: 'CM',
      latitude: 6.039,
      longitude: 10.123,
    },
    {
      iataCode: 'BFX',
      name: 'Aéroport de Bafoussam',
      city: 'Bafoussam',
      country: 'Cameroun',
      countryCode: 'CM',
      latitude: 5.537,
      longitude: 10.354,
    },
    {
      iataCode: 'BTA',
      name: 'Aéroport de Bertoua',
      city: 'Bertoua',
      country: 'Cameroun',
      countryCode: 'CM',
      latitude: 4.549,
      longitude: 13.726,
    },
    {
      iataCode: 'CDG',
      name: 'Aéroport de Paris-Charles-de-Gaulle',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      latitude: 49.0097,
      longitude: 2.5479,
    },
    {
      iataCode: 'ORY',
      name: 'Aéroport de Paris-Orly',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      latitude: 48.7262,
      longitude: 2.3652,
    },
    {
      iataCode: 'ABJ',
      name: 'Aéroport international Félix-Houphouët-Boigny',
      city: 'Abidjan',
      country: 'Côte d’Ivoire',
      countryCode: 'CI',
      latitude: 5.2614,
      longitude: -3.9263,
    },
    {
      iataCode: 'DSS',
      name: 'Aéroport international Blaise-Diagne',
      city: 'Dakar',
      country: 'Sénégal',
      countryCode: 'SN',
      latitude: 14.6711,
      longitude: -17.0672,
    }
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
