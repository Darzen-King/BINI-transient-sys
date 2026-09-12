import {
  paymentCreateInputSchema,
  paymentCreateResultSchema,
  paymentManualCreateInputSchema,
  paymentManualCreateResultSchema,
  paymentRefundInputSchema,
  paymentRefundResultSchema,
  type PaymentCreateInput,
  type PaymentCreateResult,
  type PaymentManualCreateInput,
  type PaymentManualCreateResult,
  type PaymentRefundInput,
  type PaymentRefundResult,
} from "@bini/cloud-shared";
import { httpsCallable, type Functions } from "firebase/functions";

export interface PaymentCreateGateway {
  create(input: PaymentCreateInput): Promise<PaymentCreateResult>;
  manualCreate?(
    input: PaymentManualCreateInput,
  ): Promise<PaymentManualCreateResult>;
  refund?(input: PaymentRefundInput): Promise<PaymentRefundResult>;
}

export function createPaymentCreateGateway(
  functions: Functions,
): PaymentCreateGateway {
  return {
    async create(input) {
      const call = httpsCallable<PaymentCreateInput, unknown>(
        functions,
        "paymentCreate",
      );
      return paymentCreateResultSchema.parse(
        (await call(paymentCreateInputSchema.parse(input))).data,
      );
    },
    async manualCreate(input) {
      const call = httpsCallable<PaymentManualCreateInput, unknown>(
        functions,
        "paymentManualCreate",
      );
      return paymentManualCreateResultSchema.parse(
        (await call(paymentManualCreateInputSchema.parse(input))).data,
      );
    },
    async refund(input) {
      const call = httpsCallable<PaymentRefundInput, unknown>(
        functions,
        "paymentRefund",
      );
      return paymentRefundResultSchema.parse(
        (await call(paymentRefundInputSchema.parse(input))).data,
      );
    },
  };
}
