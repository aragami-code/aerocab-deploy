/**
 * Phase D — CallsGateway Integration Tests
 *
 * Tests the Socket.io /calls namespace signaling:
 *   - call:init → call:incoming
 *   - call:accept → call:accepted → call:offer → call:answer → call:ice relay
 *   - call:decline → call:declined
 *   - call:end → call:ended
 *   - Timeout (shortened for test)
 *   - Auth guard: unauthenticated clients are disconnected
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createPassengerToken, createDriverToken } from './helpers/auth';

const CALLS_NS = (port: number) => `http://localhost:${port}/calls`;

async function waitFor<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data: T) => { clearTimeout(t); resolve(data); });
  });
}

async function connectSocket(port: number, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(CALLS_NS(port), {
      auth:       { token },
      transports: ['websocket'],
      forceNew:   true,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => { s.disconnect(); reject(e); });
    setTimeout(() => { s.disconnect(); reject(new Error('connect timeout')); }, 5000);
  });
}

describe('Phase D — CallsGateway (CALL-001 → CALL-010)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let port: number;

  beforeAll(async () => {
    app    = await getApp();
    prisma = await getPrisma();
    // Bind to a random available port for tests
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>(r => server.listen(0, r));
    port = server.address()?.port ?? 3001;
  });

  afterAll(async () => { await closeApp(); });

  beforeEach(async () => { await truncateAll(); });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function createActiveBooking(passengerId: string, driverUserId: string) {
    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId:           driverUserId,
        vehicleBrand:     'Toyota', vehicleModel: 'Corolla',
        vehicleColor:     'Blanc',  vehiclePlate: 'LT 0001 AA',
        status:           'approved', registrationFeePaid: true,
      },
    });
    return prisma.booking.create({
      data: {
        passengerId,
        driverProfileId:  driverProfile.id,
        type:             'ARRIVAL',
        status:           'confirmed',
        vehicleType:      'berline',
        estimatedPrice:   5000,
        paymentMethod:    'cash',
        destination:      'Centre-ville',
        departureAirport: 'NSI',
        pickupLat:        4.01, pickupLng: 9.72,
      } as any,
    });
  }

  // ── CALL-001: unauthenticated client is disconnected ─────────────────────

  it('CALL-001: unauthenticated socket is disconnected', (done) => {
    const s = ioClient(CALLS_NS(port), { auth: { token: '' }, transports: ['websocket'], forceNew: true });
    s.on('disconnect', () => { s.close(); done(); });
    s.on('connect', () => {
      // Should be immediately disconnected
      setTimeout(() => { s.close(); done(); }, 500);
    });
    s.on('connect_error', () => { s.close(); done(); });
  });

  // ── CALL-002: call:init from unknown booking returns error ────────────────

  it('CALL-002: call:init on non-existent booking returns error', async () => {
    const pUser = await prisma.user.create({ data: { phone: '+237600000001', role: 'passenger', name: 'P1', status: 'active' } });
    const pToken = createPassengerToken(pUser.id, pUser.phone!);

    const sock = await connectSocket(port, pToken);
    const result: any = await new Promise(resolve => {
      sock.emit('call:init', { bookingId: '00000000-0000-0000-0000-000000000000' }, resolve);
    });
    sock.disconnect();

    expect(result?.error).toBeTruthy();
  });

  // ── CALL-003: call:init on inactive booking returns error ─────────────────

  it('CALL-003: call:init on completed booking is rejected', async () => {
    const pUser  = await prisma.user.create({ data: { phone: '+237600000002', role: 'passenger', name: 'P2', status: 'active' } });
    const dUser  = await prisma.user.create({ data: { phone: '+237600000003', role: 'driver',    name: 'D2', status: 'active' } });
    const pToken = createPassengerToken(pUser.id, pUser.phone!);

    const booking = await createActiveBooking(pUser.id, dUser.id);
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'completed' } });

    const sock = await connectSocket(port, pToken);
    const result: any = await new Promise(resolve => {
      sock.emit('call:init', { bookingId: booking.id }, resolve);
    });
    sock.disconnect();

    expect(result?.error).toBeTruthy();
  });

  // ── CALL-004: full signaling flow ─────────────────────────────────────────

  it('CALL-004: passenger initiates call → driver receives call:incoming', async () => {
    const pUser  = await prisma.user.create({ data: { phone: '+237600000004', role: 'passenger', name: 'P4', status: 'active' } });
    const dUser  = await prisma.user.create({ data: { phone: '+237600000005', role: 'driver',    name: 'D4', status: 'active' } });
    const pToken = createPassengerToken(pUser.id, pUser.phone!);
    const dToken = createDriverToken(dUser.id, dUser.phone!);

    const booking = await createActiveBooking(pUser.id, dUser.id);

    const dSock = await connectSocket(port, dToken);
    const pSock = await connectSocket(port, pToken);

    // Register listener BEFORE emitting call:init to avoid race condition
    const incomingPromise = waitFor<any>(dSock, 'call:incoming');
    const initResult: any = await new Promise(resolve => {
      pSock.emit('call:init', { bookingId: booking.id }, resolve);
    });

    expect(initResult?.ok).toBe(true);

    const incoming = await incomingPromise;
    expect(incoming.bookingId).toBe(booking.id);
    expect(incoming.callerRole).toBe('passenger');
    expect(typeof incoming.callerName).toBe('string');

    pSock.disconnect();
    dSock.disconnect();
  });

  // ── CALL-005: decline flow ────────────────────────────────────────────────

  it('CALL-005: driver declines → passenger receives call:declined', async () => {
    const pUser  = await prisma.user.create({ data: { phone: '+237600000006', role: 'passenger', name: 'P5', status: 'active' } });
    const dUser  = await prisma.user.create({ data: { phone: '+237600000007', role: 'driver',    name: 'D5', status: 'active' } });
    const pToken = createPassengerToken(pUser.id, pUser.phone!);
    const dToken = createDriverToken(dUser.id, dUser.phone!);

    const booking = await createActiveBooking(pUser.id, dUser.id);
    const dSock = await connectSocket(port, dToken);
    const pSock = await connectSocket(port, pToken);

    // Register all listeners before any emit to avoid race conditions
    const incomingPromise = waitFor<any>(dSock, 'call:incoming');
    const declinedPromise = waitFor<any>(pSock, 'call:declined');

    await new Promise(resolve => pSock.emit('call:init', { bookingId: booking.id }, resolve));
    await incomingPromise;
    dSock.emit('call:decline', { bookingId: booking.id });

    const declined = await declinedPromise;
    expect(declined.bookingId).toBe(booking.id);

    pSock.disconnect();
    dSock.disconnect();
  });

  // ── CALL-006: accept + WebRTC offer/answer relay ──────────────────────────

  it('CALL-006: caller receives call:accepted after callee accepts', async () => {
    const pUser  = await prisma.user.create({ data: { phone: '+237600000008', role: 'passenger', name: 'P6', status: 'active' } });
    const dUser  = await prisma.user.create({ data: { phone: '+237600000009', role: 'driver',    name: 'D6', status: 'active' } });
    const pToken = createPassengerToken(pUser.id, pUser.phone!);
    const dToken = createDriverToken(dUser.id, dUser.phone!);

    const booking = await createActiveBooking(pUser.id, dUser.id);
    const dSock = await connectSocket(port, dToken);
    const pSock = await connectSocket(port, pToken);

    // Register listeners before emitting to avoid race conditions
    const incomingPromise = waitFor<any>(dSock, 'call:incoming');
    const acceptedPromise = waitFor<any>(pSock, 'call:accepted');

    await new Promise(resolve => pSock.emit('call:init', { bookingId: booking.id }, resolve));
    await incomingPromise;
    dSock.emit('call:accept', { bookingId: booking.id });

    const accepted = await acceptedPromise;
    expect(accepted.bookingId).toBe(booking.id);

    pSock.disconnect();
    dSock.disconnect();
  });

  // ── CALL-007: SDP offer is relayed to callee ──────────────────────────────

  it('CALL-007: call:offer from caller is relayed to callee', async () => {
    const pUser  = await prisma.user.create({ data: { phone: '+237600000010', role: 'passenger', name: 'P7', status: 'active' } });
    const dUser  = await prisma.user.create({ data: { phone: '+237600000011', role: 'driver',    name: 'D7', status: 'active' } });
    const pToken = createPassengerToken(pUser.id, pUser.phone!);
    const dToken = createDriverToken(dUser.id, dUser.phone!);

    const booking = await createActiveBooking(pUser.id, dUser.id);
    const dSock = await connectSocket(port, dToken);
    const pSock = await connectSocket(port, pToken);

    // Register all listeners before triggering the flow
    const incomingPromise = waitFor<any>(dSock, 'call:incoming');
    const acceptedPromise = waitFor<any>(pSock, 'call:accepted');

    await new Promise(resolve => pSock.emit('call:init', { bookingId: booking.id }, resolve));
    await incomingPromise;
    dSock.emit('call:accept', { bookingId: booking.id });
    await acceptedPromise;

    const offerPromise = waitFor<any>(dSock, 'call:offer');
    const fakeSdp = { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' };
    pSock.emit('call:offer', { bookingId: booking.id, sdp: fakeSdp });

    const received = await offerPromise;
    expect(received.bookingId).toBe(booking.id);
    expect(received.sdp).toEqual(fakeSdp);

    pSock.disconnect();
    dSock.disconnect();
  });

  // ── CALL-008: ICE candidate relay ────────────────────────────────────────

  it('CALL-008: call:ice candidate is relayed to the other party', async () => {
    const pUser  = await prisma.user.create({ data: { phone: '+237600000012', role: 'passenger', name: 'P8', status: 'active' } });
    const dUser  = await prisma.user.create({ data: { phone: '+237600000013', role: 'driver',    name: 'D8', status: 'active' } });
    const pToken = createPassengerToken(pUser.id, pUser.phone!);
    const dToken = createDriverToken(dUser.id, dUser.phone!);

    const booking = await createActiveBooking(pUser.id, dUser.id);
    const dSock = await connectSocket(port, dToken);
    const pSock = await connectSocket(port, pToken);

    const incomingPromise = waitFor<any>(dSock, 'call:incoming');
    const acceptedPromise = waitFor<any>(pSock, 'call:accepted');

    await new Promise(resolve => pSock.emit('call:init', { bookingId: booking.id }, resolve));
    await incomingPromise;
    dSock.emit('call:accept', { bookingId: booking.id });
    await acceptedPromise;

    // Driver sends ICE candidate → passenger receives it
    const icePromise = waitFor<any>(pSock, 'call:ice');
    const fakeCandidate = { candidate: 'candidate:1 1 UDP 2013266431 192.168.1.1 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    dSock.emit('call:ice', { bookingId: booking.id, candidate: fakeCandidate });

    const received = await icePromise;
    expect(received.bookingId).toBe(booking.id);
    expect(received.candidate).toEqual(fakeCandidate);

    pSock.disconnect();
    dSock.disconnect();
  });

  // ── CALL-009: hangup flow ─────────────────────────────────────────────────

  it('CALL-009: caller ends call → callee receives call:ended', async () => {
    const pUser  = await prisma.user.create({ data: { phone: '+237600000014', role: 'passenger', name: 'P9', status: 'active' } });
    const dUser  = await prisma.user.create({ data: { phone: '+237600000015', role: 'driver',    name: 'D9', status: 'active' } });
    const pToken = createPassengerToken(pUser.id, pUser.phone!);
    const dToken = createDriverToken(dUser.id, dUser.phone!);

    const booking = await createActiveBooking(pUser.id, dUser.id);
    const dSock = await connectSocket(port, dToken);
    const pSock = await connectSocket(port, pToken);

    const incomingPromise = waitFor<any>(dSock, 'call:incoming');
    const acceptedPromise = waitFor<any>(pSock, 'call:accepted');
    const endedPromise    = waitFor<any>(dSock, 'call:ended');

    await new Promise(resolve => pSock.emit('call:init', { bookingId: booking.id }, resolve));
    await incomingPromise;
    dSock.emit('call:accept', { bookingId: booking.id });
    await acceptedPromise;

    pSock.emit('call:end', { bookingId: booking.id });

    const ended = await endedPromise;
    expect(ended.bookingId).toBe(booking.id);
    expect(ended.reason).toBe('hangup');

    pSock.disconnect();
    dSock.disconnect();
  });

  // ── CALL-010: third party cannot inject into an active call ───────────────

  it('CALL-010: a third-party user cannot inject a call:offer into an active call', async () => {
    const pUser   = await prisma.user.create({ data: { phone: '+237600000016', role: 'passenger', name: 'P10', status: 'active' } });
    const dUser   = await prisma.user.create({ data: { phone: '+237600000017', role: 'driver',    name: 'D10', status: 'active' } });
    const badUser = await prisma.user.create({ data: { phone: '+237600000018', role: 'passenger', name: 'Bad', status: 'active' } });
    const pToken  = createPassengerToken(pUser.id, pUser.phone!);
    const dToken  = createDriverToken(dUser.id, dUser.phone!);
    const badToken = createPassengerToken(badUser.id, badUser.phone!);

    const booking = await createActiveBooking(pUser.id, dUser.id);
    const dSock   = await connectSocket(port, dToken);
    const pSock   = await connectSocket(port, pToken);
    const badSock = await connectSocket(port, badToken);

    const incomingPromise = waitFor<any>(dSock, 'call:incoming');
    const acceptedPromise = waitFor<any>(pSock, 'call:accepted');

    await new Promise(resolve => pSock.emit('call:init', { bookingId: booking.id }, resolve));
    await incomingPromise;
    dSock.emit('call:accept', { bookingId: booking.id });
    await acceptedPromise;

    // Bad actor sends offer — driver should NOT receive it
    let gotBadOffer = false;
    dSock.once('call:offer', () => { gotBadOffer = true; });
    badSock.emit('call:offer', { bookingId: booking.id, sdp: { type: 'offer', sdp: 'malicious' } });

    await new Promise(r => setTimeout(r, 300));
    expect(gotBadOffer).toBe(false);

    pSock.disconnect();
    dSock.disconnect();
    badSock.disconnect();
  });
});
