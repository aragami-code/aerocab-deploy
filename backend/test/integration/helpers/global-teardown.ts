import { PrismaClient } from '@prisma/client';

export default async function globalTeardown() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  await prisma.$disconnect();
}
