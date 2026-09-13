import {
  cashierCloseInputSchema,
  cashierCloseResultSchema,
  paymentCreateInputSchema,
  paymentCreateResultSchema,
  paymentExportInputSchema,
  paymentExportResultSchema,
  paymentManualCreateInputSchema,
  paymentManualCreateResultSchema,
  paymentRefundInputSchema,
  paymentRefundResultSchema,
  paymentVoidInputSchema,
  paymentVoidResultSchema,
  type PaymentCreateInput,
  type PaymentCreateResult,
  type PaymentExportInput,
  type PaymentExportResult,
  type CashierCloseInput,
  type CashierCloseResult,
  type PaymentManualCreateInput,
  type PaymentManualCreateResult,
  type PaymentRefundInput,
  type PaymentRefundResult,
  type PaymentVoidInput,
  type PaymentVoidResult,
} from "@bini/cloud-shared";
import { httpsCallable, type Functions } from "firebase/functions";

export interface PaymentCreateGateway {
  create(input: PaymentCreateInput): Promise<PaymentCreateResult>;
  cashierClose?(input: CashierCloseInput): Promise<CashierCloseResult>;
  manualCreate?(
    input: PaymentManualCreateInput,
  ): Promise<PaymentManualCreateResult>;
  refund?(input: PaymentRefundInput): Promise<PaymentRefundResult>;
  void?(input: PaymentVoidInput): Promise<PaymentVoidResult>;
  exportCsv?(input: PaymentExportInput): Promise<PaymentExportResult>;
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
    async cashierClose(input) {
      const call = httpsCallable<CashierCloseInput, unknown>(
        functions,
        "cashierClose",
      );
      return cashierCloseResultSchema.parse(
        (await call(cashierCloseInputSchema.parse(input))).data,
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
    async exportCsv(input) {
      const call = httpsCallable<PaymentExportInput, unknown>(
        functions,
        "paymentExportCsv",
      );
      return paymentExportResultSchema.parse(
        (await call(paymentExportInputSchema.parse(input))).data,
      );
    },
    async void(input) {
      const call = httpsCallable<PaymentVoidInput, unknown>(functions, 'paymentVoid');
      return paymentVoidResultSchema.parse((await call(paymentVoidInputSchema.parse(input))).data);
    },
  };
}
