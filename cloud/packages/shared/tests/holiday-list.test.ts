import { describe, expect, it } from 'vitest';
import { buildHolidayList, holidayManualUpsertInputSchema } from '@bini/cloud-shared';

describe('holiday list projection', () => {
  it('keeps migrated and manually managed fields in chronological order', () => {
    expect(buildHolidayList([
      { id: '2026-10-10', data: { date: '2026-10-10', year: 2026, description: '國慶日', holiday: true, manual: false, source: 'api' } },
      { id: '2026-01-01', data: { date: '2026-01-01', year: 2026, description: '元旦', holiday: true, manual: true, source: 'manual', version: 2 } },
    ])).toEqual([
      { date: '2026-01-01', year: 2026, description: '元旦', holiday: true, manual: true, source: 'manual', version: 2 },
      { date: '2026-10-10', year: 2026, description: '國慶日', holiday: true, manual: false, source: 'api', version: 0 },
    ]);
  });

  it('rejects a date that does not belong to its declared year', () => {
    expect(() => buildHolidayList([{ id: 'invalid', data: { date: '2026-01-01', year: 2025, holiday: true } }])).toThrow('資料格式不正確');
  });

  it('keeps the v3 optional manual description contract', () => {
    expect(holidayManualUpsertInputSchema.safeParse({ propertyId: 'property-main', operationId: 'b9f3a2e0-a0ba-4c18-9e4d-788cf33bbfd7', date: '2026-01-01', description: '  ' }).success).toBe(true);
  });
});
