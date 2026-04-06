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
