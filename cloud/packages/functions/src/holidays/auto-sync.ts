import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { planHolidayAutoSync, holidayYearNeedsSync, type ExistingHoliday } from './auto-sync-plan.js';
import { loadHolidaySource } from './holiday-operations.js';

const taipeiYear = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(new Date()));

/**
 * Replaces v3's background holiday sync on every app start: each active property keeps this year and
 * next year's government holidays, without deleting rows or overwriting manual days. Runs daily at 04:00 Taipei.
 */
export const holidayAutoSync = onSchedule({ schedule: '0 4 * * *', timeZone: 'Asia/Taipei', region: 'asia-east1', timeoutSeconds: 300, memory: '256MiB', maxInstances: 1 }, async () => {
  const db = getFirestore();
  const properties = await db.collection('properties').get();
  const year = taipeiYear();
  for (const property of properties.docs) {
    const data = property.data();
    const legacy = data.legacyV3Import as { active?: unknown } | undefined;
    if (data.active === false || legacy?.active === false) continue;
    const root = `properties/${property.id}`;
    for (const target of [year, year + 1]) {
      try {
        const snapshot = await db.collection(`${root}/holidays`).where('year', '==', target).get();
        const existing: ExistingHoliday[] = snapshot.docs.map((document) => ({ date: document.id, ...document.data() }) as ExistingHoliday);
        // Only reach out to the government API when v3's rule says the year still needs data.
        const incoming = holidayYearNeedsSync(existing, target) ? await loadHolidaySource(target) : null;
        const operationId = randomUUID();
        const now = new Date().toISOString();
        const committed = await db.runTransaction(async (transaction) => {
          const fresh = await transaction.get(db.collection(`${root}/holidays`).where('year', '==', target));
          const plan = planHolidayAutoSync(fresh.docs.map((document) => ({ date: document.id, ...document.data() }) as ExistingHoliday), target, incoming, { propertyId: property.id, now });
          if (plan.action === 'skip') return plan;
          for (const write of plan.writes) transaction.set(db.doc(`${root}/holidays/${write.date}`), write.data, { merge: true });
          transaction.create(db.doc(`${root}/holidaySyncRuns/${operationId}`), { operationId, actorUid: 'system', trigger: 'schedule', propertyId: property.id, year: target, source: plan.source, syncedCount: plan.syncedCount, manualRetained: plan.manualRetained, createdAt: now });
          transaction.create(db.doc(`${root}/auditLogs/holiday-auto-sync-${operationId}`), { actorUid: 'system', action: 'holiday.auto_sync', targetId: String(target), targetType: 'holidayCalendar', details: { year: target, source: plan.source, syncedCount: plan.syncedCount, manualRetained: plan.manualRetained }, createdAt: now });
          return plan;
        });
        logger.info('holiday auto sync', { propertyId: property.id, year: target, action: committed.action, ...(committed.action === 'sync' ? { source: committed.source, syncedCount: committed.syncedCount } : { reason: committed.reason }) });
      } catch (error) {
        // One property or year failing must not stop the others; the next daily run retries.
        logger.error('holiday auto sync failed', { propertyId: property.id, year: target, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
});
