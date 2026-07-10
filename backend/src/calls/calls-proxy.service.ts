import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';

interface TwilioProxy {
  services: (sid: string) => {
    sessions: {
      create: (opts: { uniqueName: string; ttl?: number }) => Promise<{ sid: string }>;
      (sessionSid: string): {
        participants: {
          create: (opts: { identifier: string; friendlyName?: string }) => Promise<{ proxyIdentifier: string; sid: string }>;
        };
      };
    };
  };
}

@Injectable()
export class CallsProxyService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  private async getTwilioConfig() {
    const [accountSid, authToken, proxySid] = await Promise.all([
      this.settings.get('twilio_account_sid'),
      this.settings.get('twilio_auth_token'),
      this.settings.get('twilio_proxy_service_sid'),
    ]);
    if (!accountSid || !authToken || !proxySid) {
      throw new ServiceUnavailableException(
        'Twilio Proxy non configuré. Renseignez les credentials dans Admin → Paramètres → Téléphonie.',
      );
    }
    return { accountSid, authToken, proxySid };
  }

  private buildClient(accountSid: string, authToken: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Twilio = require('twilio');
    return new Twilio(accountSid, authToken) as { proxy: TwilioProxy['services'] extends infer T ? any : any };
  }

  async initiateProxyCall(callerId: string, bookingId: string): Promise<{ proxyNumber: string }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        passengerId: true,
        passenger: { select: { phone: true, name: true } },
        driverProfile: {
          select: {
            userId: true,
            user: { select: { phone: true, name: true } },
          },
        },
      },
    });

    if (!booking) throw new BadRequestException('Réservation introuvable');

    const validStatuses = ['confirmed', 'arrived_at_airport', 'in_progress', 'passenger_confirming'];
    if (!validStatuses.includes(booking.status)) {
      throw new BadRequestException('Appel non disponible sur cette course');
    }

    const isPassenger = booking.passengerId === callerId;
    const isDriver    = booking.driverProfile?.userId === callerId;
    if (!isPassenger && !isDriver) throw new BadRequestException('Accès non autorisé');

    const callerPhone = isPassenger
      ? booking.passenger?.phone
      : booking.driverProfile?.user?.phone;
    const calleePhone = isPassenger
      ? booking.driverProfile?.user?.phone
      : booking.passenger?.phone;

    if (!callerPhone || !calleePhone) {
      throw new BadRequestException('Numéro de téléphone manquant');
    }

    const { accountSid, authToken, proxySid } = await this.getTwilioConfig();
    const client = this.buildClient(accountSid, authToken);

    // Crée ou réutilise une session Proxy pour ce booking (TTL 2h)
    const sessionName = `booking-${bookingId}`;
    let sessionSid: string;

    try {
      const session = await client.proxy.services(proxySid).sessions.create({
        uniqueName: sessionName,
        ttl: 7200,
      });
      sessionSid = session.sid;
    } catch (err: any) {
      // Session déjà existante (code 20422) → on la récupère
      if (err?.code === 20422 || err?.status === 409) {
        const existing = await client.proxy.services(proxySid).sessions.list({ uniqueName: sessionName });
        if (!existing?.length) throw new ServiceUnavailableException('Impossible de créer la session Twilio Proxy');
        sessionSid = existing[0].sid;
      } else {
        throw new ServiceUnavailableException(`Twilio Proxy erreur: ${err?.message ?? err}`);
      }
    }

    const sessionCtx = client.proxy.services(proxySid).sessions(sessionSid);

    // Ajoute les deux participants (idempotent : Twilio renvoie l'existant si déjà présent)
    const [callerParticipant] = await Promise.all([
      sessionCtx.participants.create({ identifier: callerPhone, friendlyName: isPassenger ? 'Passager' : 'Chauffeur' }),
      sessionCtx.participants.create({ identifier: calleePhone, friendlyName: isPassenger ? 'Chauffeur' : 'Passager' }),
    ]);

    return { proxyNumber: callerParticipant.proxyIdentifier };
  }

  async getTelephonyConfig(): Promise<{
    callsProvider: 'webrtc' | 'twilio_proxy';
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioProxyServiceSid: string;
    configured: boolean;
  }> {
    const [provider, sid, token, proxySid] = await Promise.all([
      this.settings.get('calls_provider', 'webrtc'),
      this.settings.get('twilio_account_sid'),
      this.settings.get('twilio_auth_token'),
      this.settings.get('twilio_proxy_service_sid'),
    ]);
    return {
      callsProvider:        (provider as 'webrtc' | 'twilio_proxy'),
      twilioAccountSid:     sid  ? `${sid.slice(0, 6)}${'*'.repeat(Math.max(0, sid.length - 6))}` : '',
      twilioAuthToken:      token ? `${'*'.repeat(Math.max(0, token.length - 4))}${token.slice(-4)}` : '',
      twilioProxyServiceSid: proxySid ? `${proxySid.slice(0, 6)}${'*'.repeat(Math.max(0, proxySid.length - 6))}` : '',
      configured:           !!(sid && token && proxySid),
    };
  }

  async saveTelephonyConfig(dto: {
    callsProvider: 'webrtc' | 'twilio_proxy';
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioProxyServiceSid?: string;
  }): Promise<void> {
    await this.settings.set('calls_provider', dto.callsProvider);
    if (dto.twilioAccountSid)     await this.settings.set('twilio_account_sid',       dto.twilioAccountSid);
    if (dto.twilioAuthToken)      await this.settings.set('twilio_auth_token',         dto.twilioAuthToken);
    if (dto.twilioProxyServiceSid) await this.settings.set('twilio_proxy_service_sid', dto.twilioProxyServiceSid);
  }
}
