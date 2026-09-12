import { paymentCreateInputSchema, paymentCreateResultSchema, type PaymentCreateInput, type PaymentCreateResult } from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface PaymentCreateGateway { create(input: PaymentCreateInput): Promise<PaymentCreateResult>; }

export function createPaymentCreateGateway(functions: Functions): PaymentCreateGateway {
  return { async create(input) { const call = httpsCallable<PaymentCreateInput, unknown>(functions, 'paymentCreate'); return paymentCreateResultSchema.parse((await call(paymentCreateInputSchema.parse(input))).data); } };
}
