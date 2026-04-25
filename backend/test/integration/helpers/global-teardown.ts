import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

export default async function globalTeardown() {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env.test') });
  const prisma = new PrismaClient();
  await prisma.$disconnect();
}
