import { getApp, closeApp } from './app';
import { truncateAll } from './db';
import { createPassengerToken } from './auth';
import { randomUUID } from 'crypto';

describe('Test helpers smoke test', () => {
  afterAll(async () => {
    await closeApp();
  });

  it('getApp() returns a NestJS app', async () => {
    const app = await getApp();
    expect(app).toBeDefined();
    expect(app.getHttpServer()).toBeDefined();
  });

  it('getApp() returns same instance on second call (singleton)', async () => {
    const app1 = await getApp();
    const app2 = await getApp();
    expect(app1).toBe(app2);
  });

  it('truncateAll() runs without error', async () => {
    await expect(truncateAll()).resolves.not.toThrow();
  });

  it('createPassengerToken() returns a valid JWT string', () => {
    const token = createPassengerToken(randomUUID(), '+237600000001');
    expect(token).toMatch(/^eyJ/);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });
});
