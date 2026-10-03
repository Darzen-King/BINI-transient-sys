import { z } from "zod";

/** v3 canonical category keys; do not rename without a migration. */
export const COST_CATEGORIES = [
  "utilities",
  "cleaning_supplies",
  "laundry",
  "maintenance",
  "consumables",
  "staff",
  "rent",
  "internet_software",
  "marketing",
  "misc",
] as const;
/**
 * `card` = paid by credit card in one go; `card_installment` = paid by credit card in `installmentPeriods`
 * monthly installments (the accounting app links the card and spreads the periods over the card bills).
 */
export const COST_PAYMENT_METHODS = [
  "cash",
  "transfer",
  "card",
  "card_installment",
  "other",
] as const;
export const COST_INSTALLMENT_MIN = 2;
export const COST_INSTALLMENT_MAX = 120;
const propertyId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const operationId = z.string().uuid();
const costId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().int().safe().min(0).max(100_000_000);
const installmentPeriods = z
  .number()
  .int()
  .min(COST_INSTALLMENT_MIN)
  .max(COST_INSTALLMENT_MAX);

export const costFieldsSchema = z
  .object({
    costDate: date,
    category: z.enum(COST_CATEGORIES),
    subcategory: z.string().trim().max(100).nullable().optional(),
    amountNts: amount,
    paymentMethod: z.enum(COST_PAYMENT_METHODS),
    installmentPeriods: installmentPeriods.nullable().optional(),
    vendor: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
    recurring: z.boolean(),
    receiptNo: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
/** Installment periods are required for `card_installment` and meaningless for every other method. */
function requireInstallmentsOnlyForInstallmentPayment(
  value: { paymentMethod: (typeof COST_PAYMENT_METHODS)[number]; installmentPeriods?: number | null | undefined },
  context: z.RefinementCtx,
) {
  const has = typeof value.installmentPeriods === "number";
  if (value.paymentMethod === "card_installment" && !has)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["installmentPeriods"],
      message: "分期付款必須填寫期數。",
    });
  if (value.paymentMethod !== "card_installment" && has)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["installmentPeriods"],
      message: "只有信用卡分期可以填寫期數。",
    });
}
export const costCreateInputSchema = z
  .object({ propertyId, operationId, ...costFieldsSchema.shape })
  .strict()
  .superRefine(requireInstallmentsOnlyForInstallmentPayment);
export const costUpdateInputSchema = z
  .object({
    propertyId,
    operationId,
    costId,
    baseVersion: z.number().int().min(0),
    ...costFieldsSchema.shape,
  })
  .strict()
  .superRefine(requireInstallmentsOnlyForInstallmentPayment);
export const costArchiveInputSchema = z
  .object({
    propertyId,
    operationId,
    costId,
    baseVersion: z.number().int().min(0),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type CostCreateInput = z.infer<typeof costCreateInputSchema>;
export type CostUpdateInput = z.infer<typeof costUpdateInputSchema>;
export type CostArchiveInput = z.infer<typeof costArchiveInputSchema>;
export const costOperationResultSchema = z
  .object({
    status: z.enum(["created", "updated", "archived", "replayed"]),
    costId,
    version: z.number().int().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type CostOperationResult = z.infer<typeof costOperationResultSchema>;
