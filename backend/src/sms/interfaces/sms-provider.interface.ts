export interface ISmsProvider {
  send(to: string, message: string): Promise<boolean>;
  readonly name: string;
}
