import { execFileSync } from 'child_process';
import * as path from 'path';
import * as dotenv from 'dotenv';

export default async function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env.test') });

  execFileSync(
    'npx',
    ['prisma', 'migrate', 'deploy'],
    {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'inherit',
    },
  );

  execFileSync(
    'npx',
    ['ts-node', 'prisma/seed.ts'],
    {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'inherit',
    },
  );
}
