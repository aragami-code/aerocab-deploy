import { execFileSync } from 'child_process';
import * as path from 'path';
import * as dotenv from 'dotenv';

export default async function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env.test') });

  const cwd = path.resolve(__dirname, '../../..');
  const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL };

  // Sync schema to test DB
  execFileSync('npx', ['prisma', 'db', 'push', '--accept-data-loss', '--skip-generate'], { cwd, env, stdio: 'inherit' });

  // Generate Prisma client so ts-node can resolve @prisma/client
  execFileSync('npx', ['prisma', 'generate'], { cwd, env, stdio: 'inherit' });

  // Seed default AppSettings
  execFileSync(
    'node',
    ['--require', 'ts-node/register', 'prisma/seed.ts'],
    {
      cwd,
      env: { ...env, TS_NODE_PROJECT: path.resolve(cwd, 'tsconfig.json') },
      stdio: 'inherit',
    },
  );

  // Seed RBAC (permissions + roles + matrix) — required for PermissionsGuard in integration tests
  execFileSync(
    'node',
    ['--require', 'ts-node/register', 'prisma/seed-rbac.ts'],
    {
      cwd,
      env: { ...env, TS_NODE_PROJECT: path.resolve(cwd, 'tsconfig.json') },
      stdio: 'inherit',
    },
  );
}
