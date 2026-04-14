import { Injectable, Logger } from '@nestjs/common';
import { IEmailProvider } from '../interfaces/email-provider.interface';

@Injectable()
export class MockEmailProvider implements IEmailProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockEmailProvider.name);

  async send(to: string, subject: string, html: string): Promise<boolean> {
    this.logger.log(`[MockEmail] To: ${to} | Subject: ${subject} | ${html.slice(0, 80)}...`);
    return true;
  }
}
