import { describe, expect, it } from 'vitest';

import { costDocumentFields } from '../src/costs/cost-fields.js';

const base = { costDate: '2026-09-13', category: 'maintenance', amountNts: 36_000, recurring: false };

describe('cost document fields', () => {
  it('stores the period count only for a credit-card installment cost', () => {
    expect(costDocumentFields({ ...base, paymentMethod: 'card_installment', installmentPeriods: 6 })).toMatchObject({ paymentMethod: 'card_installment', installmentPeriods: 6 });
    // Anything else clears it, so editing an installment cost into a cash one leaves no stale period count behind.
    for (const method of ['cash', 'transfer', 'card', 'other']) {
      expect(costDocumentFields({ ...base, paymentMethod: method, installmentPeriods: 6 }).installmentPeriods).toBeNull();
      expect(costDocumentFields({ ...base, paymentMethod: method }).installmentPeriods).toBeNull();
    }
  });

  it('reads the "before" side of an audit entry from an older document that has no period count', () => {
    expect(costDocumentFields({ ...base, paymentMethod: 'card' })).toMatchObject({ paymentMethod: 'card', installmentPeriods: null, vendor: null, receiptNo: null });
  });
});
