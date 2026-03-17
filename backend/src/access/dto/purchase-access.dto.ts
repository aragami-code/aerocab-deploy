import { IsEnum } from 'class-validator';

export enum PaymentMethodEnum {
  ORANGE_MONEY = 'orange_money',
  MTN_MOMO = 'mtn_momo',
}

export class PurchaseAccessDto {
  @IsEnum(PaymentMethodEnum, {
    message:
      'Methode de paiement invalide. Valeurs acceptees: orange_money, mtn_momo',
  })
  paymentMethod!: PaymentMethodEnum;
}
