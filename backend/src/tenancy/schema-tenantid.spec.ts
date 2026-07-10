import { readFileSync } from 'fs';
import { join } from 'path';
import { TENANT_SCOPED_MODELS } from './tenant.constants';

const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

/** Extrait le bloc d'un modèle Prisma par son nom. */
function modelBlock(name: string): string {
  const re = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, 'm');
  const m = schema.match(re);
  if (!m) throw new Error(`modèle ${name} introuvable`);
  return m[1];
}

describe('tenantId nullable sur les modèles scopés', () => {
  for (const model of TENANT_SCOPED_MODELS) {
    it(`${model} a un champ tenantId String? mappé tenant_id`, () => {
      const block = modelBlock(model);
      expect(block).toMatch(/tenantId\s+String\?\s+@map\("tenant_id"\)/);
    });
  }
  it('AppSetting a tenantId nullable', () => {
    expect(modelBlock('AppSetting')).toMatch(/tenantId\s+String\?\s+@map\("tenant_id"\)/);
  });
});
