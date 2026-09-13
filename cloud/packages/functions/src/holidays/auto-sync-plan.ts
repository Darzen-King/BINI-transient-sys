export interface ExistingHoliday { date: string; year: unknown; manual: unknown; source: unknown; version: unknown; createdAt: unknown; }
export interface IncomingHolidays { source: 'api' | 'fallback'; items: ReadonlyArray<{ date: string; description: string }>; }

export type HolidayAutoSyncPlan =
  | { action: 'skip'; reason: 'api-present' | 'no-source' }
  | { action: 'sync'; source: 'api' | 'fallback'; syncedCount: number; manualRetained: number; writes: ReadonlyArray<{ date: string; data: Record<string, unknown> }> };

/** v3 `sync_holidays` skips a year that already holds more than five government (API) rows. */
export function holidayYearNeedsSync(existing: readonly ExistingHoliday[], year: number): boolean {
  return existing.filter((holiday) => holiday.year === year && holiday.source === 'api').length <= 5;
}

/**
 * v3 startup sync semantics: create or refresh non-manual rows for the year, never touch manual entries,
 * and never delete anything (unlike the staff-triggered resync, which replaces the year's non-manual rows).
 */
export function planHolidayAutoSync(existing: readonly ExistingHoliday[], year: number, incoming: IncomingHolidays | null, context: { propertyId: string; now: string }): HolidayAutoSyncPlan {
  if (!holidayYearNeedsSync(existing, year)) return { action: 'skip', reason: 'api-present' };
  if (!incoming || incoming.items.length === 0) return { action: 'skip', reason: 'no-source' };
  const byDate = new Map(existing.map((holiday) => [holiday.date, holiday]));
  const writes: Array<{ date: string; data: Record<string, unknown> }> = [];
  let manualRetained = 0;
  for (const item of incoming.items) {
    if (item.date.slice(0, 4) !== String(year)) continue;
    const current = byDate.get(item.date);
    if (current?.manual === true) { manualRetained += 1; continue; }
    const version = typeof current?.version === 'number' && Number.isInteger(current.version) ? current.version : 0;
    writes.push({ date: item.date, data: {
      schemaVersion: 4, version: version + 1, propertyId: context.propertyId, date: item.date, year, holiday: true, manual: false,
      source: incoming.source, description: item.description,
      createdAt: typeof current?.createdAt === 'string' ? current.createdAt : context.now, updatedAt: context.now, updatedByUid: 'system',
    } });
  }
  return { action: 'sync', source: incoming.source, syncedCount: writes.length, manualRetained, writes };
}
