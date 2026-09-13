import { describe, expect, it } from 'vitest';

import { holidayYearNeedsSync, planHolidayAutoSync } from '../src/holidays/auto-sync-plan.js';

const context = { propertyId: 'property-main', now: '2026-09-14T20:00:00.000Z' };
const apiRows = (year: number, count: number) => Array.from({ length: count }, (_, index) => ({ date: `${year}-01-${String(index + 1).padStart(2, '0')}`, year, manual: false, source: 'api', version: 1, createdAt: '2026-01-01T00:00:00.000Z' }));

describe('scheduled holiday sync (v3 startup sync)', () => {
  it('skips a year that already has more than five API holidays, like v3', () => {
    expect(holidayYearNeedsSync(apiRows(2026, 6), 2026)).toBe(false);
    expect(holidayYearNeedsSync(apiRows(2026, 5), 2026)).toBe(true);
    expect(planHolidayAutoSync(apiRows(2026, 6), 2026, { source: 'api', items: [{ date: '2026-10-10', description: '國慶日' }] }, context)).toEqual({ action: 'skip', reason: 'api-present' });
  });

  it('creates or refreshes non-manual days, keeps manual days, and deletes nothing', () => {
    const existing = [
      { date: '2027-01-01', year: 2027, manual: true, source: 'manual', version: 3, createdAt: '2026-12-01T00:00:00.000Z' },
      { date: '2027-02-05', year: 2027, manual: false, source: 'fallback', version: 2, createdAt: '2026-11-01T00:00:00.000Z' },
      { date: '2027-03-01', year: 2027, manual: false, source: 'fallback', version: 1, createdAt: '2026-11-01T00:00:00.000Z' },
    ];
    const plan = planHolidayAutoSync(existing, 2027, { source: 'api', items: [{ date: '2027-01-01', description: '元旦' }, { date: '2027-02-05', description: '春節' }, { date: '2027-04-04', description: '兒童節' }, { date: '2026-12-31', description: 'other year' }] }, context);
    expect(plan).toMatchObject({ action: 'sync', source: 'api', syncedCount: 2, manualRetained: 1 });
    if (plan.action !== 'sync') return;
    expect(plan.writes.map((write) => write.date)).toEqual(['2027-02-05', '2027-04-04']);
    expect(plan.writes[0]?.data).toMatchObject({ version: 3, createdAt: '2026-11-01T00:00:00.000Z', source: 'api', manual: false, updatedByUid: 'system' });
    expect(plan.writes[1]?.data).toMatchObject({ version: 1, createdAt: context.now, year: 2027, holiday: true });
  });

  it('leaves the calendar untouched when neither the government API nor the offline table has the year', () => {
    expect(planHolidayAutoSync([], 2030, null, context)).toEqual({ action: 'skip', reason: 'no-source' });
  });
});
