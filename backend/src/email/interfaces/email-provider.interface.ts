export interface IEmailProvider {
  send(to: string, subject: string, html: string): Promise<boolean>;
  readonly name: string;
}
