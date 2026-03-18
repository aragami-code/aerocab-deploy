import { execSync } from 'child_process';

// Utilise npx prisma db execute pour insérer l'admin
const sql = `
INSERT INTO "User" (id, phone, name, email, role, status, language, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  '+237691234567',
  'Admin AeroCab',
  'admin@aerocab.com',
  'admin',
  'active',
  'fr',
  NOW(),
  NOW()
)
ON CONFLICT (phone) DO UPDATE SET role = 'admin';
`;

import { writeFileSync } from 'fs';
writeFileSync('/tmp/seed-admin.sql', sql);

console.log('Exécution du SQL...');
try {
  const result = execSync(
    `npx prisma@6 db execute --file /tmp/seed-admin.sql --schema ./prisma/schema.prisma`,
    { stdio: 'pipe', encoding: 'utf-8' }
  );
  console.log('Succès:', result);
} catch (e) {
  console.error('Erreur:', e.stdout, e.stderr);
}
