import { readFileSync } from 'fs';
import { join } from 'path';
const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
const tenant = schema.match(/model Tenant \{([\s\S]*?)\n\}/)![1];
describe('Tenant branding fields', () => {
  it('a accentColor nullable', () => {
    expect(tenant).toMatch(/accentColor\s+String\?\s+@map\("accent_color"\)/);
  });
  it('a paletteId nullable', () => {
    expect(tenant).toMatch(/paletteId\s+String\?\s+@map\("palette_id"\)/);
  });
});
