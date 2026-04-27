/**
 * Points sub-balances integration tests — P001-P006
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createPassengerToken } from './helpers/auth';

describe('Points sous-soldes (P001-P006)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => { app = await getApp(); prisma = await getPrisma(); });
  afterAll(async () => { await closeApp(); });
  beforeEach(async () => { await truncateAll(); });

  async function createUser(phone = '+237699001001') {
    const user = await prisma.user.create({
      data: { phone, role: 'passenger', name: 'Test', status: 'active' },
    });
    return { user, token: createPassengerToken(user.id, user.phone!) };
  }

  it('P001: GET /points/balance — retourne 0 si aucune transaction', async () => {
    const { token } = await createUser();
    const res = await request(app.getHttpServer())
      .get('/api/points/balance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(0);
    expect(res.body.breakdown).toMatchObject({
      recharge: 0, referral: 0, loyalty: 0, bonus: 0, cashback: 0,
    });
  });

  it('P002: GET /points/balance — breakdown correct après crédits multi-sources', async () => {
    const { user, token } = await createUser();
    await prisma.pointsTransaction.createMany({
      data: [
        { userId: user.id, type: 'credit', source: 'recharge',  points: 3000, label: 'Recharge OM' },
        { userId: user.id, type: 'credit', source: 'referral',  points: 500,  label: 'Parrainage' },
        { userId: user.id, type: 'credit', source: 'loyalty',   points: 200,  label: 'Fidélité' },
        { userId: user.id, type: 'credit', source: 'cashback',  points: 150,  label: 'Cashback' },
        { userId: user.id, type: 'debit',  source: 'payment',   points: -850, label: 'Course #1' },
      ],
    });
    const res = await request(app.getHttpServer())
      .get('/api/points/balance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(3000);
    expect(res.body.breakdown.recharge).toBe(3000);
    expect(res.body.breakdown.referral).toBe(500);
    expect(res.body.breakdown.loyalty).toBe(200);
    expect(res.body.breakdown.cashback).toBe(150);
  });

  it('P003: GET /points/history — retourne toutes les transactions', async () => {
    const { user, token } = await createUser();
    await prisma.pointsTransaction.createMany({
      data: [
        { userId: user.id, type: 'credit', source: 'recharge', points: 1000, label: 'Recharge' },
        { userId: user.id, type: 'debit',  source: 'payment',  points: -500, label: 'Course' },
      ],
    });
    const res = await request(app.getHttpServer())
      .get('/api/points/history')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('P004: GET /points/history?source=loyalty — filtre correct', async () => {
    const { user, token } = await createUser();
    await prisma.pointsTransaction.createMany({
      data: [
        { userId: user.id, type: 'credit', source: 'loyalty',  points: 200,  label: 'Fidélité' },
        { userId: user.id, type: 'credit', source: 'recharge', points: 3000, label: 'Recharge' },
      ],
    });
    const res = await request(app.getHttpServer())
      .get('/api/points/history?source=loyalty')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].source).toBe('loyalty');
  });

  it('P005: GET /payments/methods — retourne les méthodes disponibles', async () => {
    const { token } = await createUser();
    const res = await request(app.getHttpServer())
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.methods).toBeInstanceOf(Array);
    expect(res.body.methods.length).toBeGreaterThan(0);
    expect(res.body.methods[0]).toHaveProperty('id');
    expect(res.body.methods[0]).toHaveProperty('label');
  });

  it('P006: PATCH /payments/default-payment-method — sauvegarde la méthode', async () => {
    const { token } = await createUser();
    const res = await request(app.getHttpServer())
      .patch('/api/payments/default-payment-method')
      .set('Authorization', `Bearer ${token}`)
      .send({ method: 'orange_money' });
    expect(res.status).toBe(200);
    expect(res.body.defaultPaymentMethod).toBe('orange_money');

    // Vérifier la lecture
    const getRes = await request(app.getHttpServer())
      .get('/api/payments/default-payment-method')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.defaultPaymentMethod).toBe('orange_money');
  });
});
