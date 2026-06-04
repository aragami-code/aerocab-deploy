export interface IWhatsAppProvider {
  send(to: string, message: string): Promise<boolean>;
  readonly name: string;
}
