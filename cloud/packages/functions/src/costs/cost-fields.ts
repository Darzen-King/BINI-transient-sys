/* The persisted shape of a cost entry's editable fields (also what the audit log records). */
export function costDocumentFields(input: Record<string, unknown>) {
  return {
    costDate: input.costDate,
    category: input.category,
    subcategory: input.subcategory ?? null,
    amountNts: input.amountNts,
    paymentMethod: input.paymentMethod,
    // Only a credit-card installment cost carries a period count (the contract enforces it); anything else clears it.
    installmentPeriods:
      input.paymentMethod === "card_installment" &&
      typeof input.installmentPeriods === "number"
        ? input.installmentPeriods
        : null,
    vendor: input.vendor ?? null,
    description: input.description ?? null,
    note: input.note ?? null,
    recurring: input.recurring,
    receiptNo: input.receiptNo ?? null,
  };
}
