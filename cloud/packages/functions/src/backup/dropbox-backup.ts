import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { DAILY_PREFIX, createDropboxClient, expiredDailyFiles } from './dropbox.js';
import { buildV3BackupPayload, type SourceDocument } from './v3-export.js';

const DROPBOX_APP_KEY = defineSecret('DROPBOX_APP_KEY');
const DROPBOX_APP_SECRET = defineSecret('DROPBOX_APP_SECRET');
const DROPBOX_REFRESH_TOKEN = defineSecret('DROPBOX_REFRESH_TOKEN');

/** v3's default remote folder; the cloud copy sits beside it so v3's own backup file is never overwritten. */
export const DROPBOX_EXPORT_FOLDER = '/BiniBloomsData/cloud_export';
export const DROPBOX_EXPORT_FILE = 'bini_blooms_backup.json';
const PROPERTY_ID = 'property-main';
const KEEP_DAILY_DAYS = 30;
const COLLECTIONS = ['rooms', 'bookings', 'stays', 'stayLogs', 'payments', 'cashierSessions', 'costEntries', 'monthlyRentals', 'holidays', 'maintenanceSchedules', 'auditLogs'] as const;

const taipeiDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/**
 * Hourly v3-format backup to Dropbox so the desktop v3 app can take over if Firebase is unavailable.
 * Writes the latest copy, overwrites today's dated copy and prunes dated copies older than 30 days.
 * The outcome is recorded in `system/dropboxBackup` (server-only; clients cannot read it).
 */
export const dropboxV3Backup = onSchedule({
  schedule: '5 * * * *',
  timeZone: 'Asia/Taipei',
  region: 'asia-east1',
  timeoutSeconds: 300,
  memory: '512MiB',
  maxInstances: 1,
  retryCount: 0,
  secrets: [DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN],
}, async () => {
  const db = getFirestore();
  const statusRef = db.doc('system/dropboxBackup');
  const startedAt = new Date();
  try {
    const root = `properties/${PROPERTY_ID}`;
    const [propertySnapshot, ...snapshots] = await Promise.all([db.doc(root).get(), ...COLLECTIONS.map((name) => db.collection(`${root}/${name}`).get())]);
    const docs = (index: number): SourceDocument[] => snapshots[index]!.docs.map((document) => ({ id: document.id, data: document.data() }));
    const payload = buildV3BackupPayload({
      propertyId: PROPERTY_ID,
      property: propertySnapshot.data() ?? {},
      ...Object.fromEntries(COLLECTIONS.map((name, index) => [name, docs(index)])) as Record<(typeof COLLECTIONS)[number], SourceDocument[]>,
    }, startedAt);
    const content = JSON.stringify(payload, null, 2);
    const today = taipeiDay(startedAt);
    const dropbox = createDropboxClient({ appKey: DROPBOX_APP_KEY.value(), appSecret: DROPBOX_APP_SECRET.value(), refreshToken: DROPBOX_REFRESH_TOKEN.value() });
    await dropbox.upload(`${DROPBOX_EXPORT_FOLDER}/${DROPBOX_EXPORT_FILE}`, content);
    await dropbox.upload(`${DROPBOX_EXPORT_FOLDER}/daily/${DAILY_PREFIX}${today}.json`, content);
    const expired = expiredDailyFiles(await dropbox.listFileNames(`${DROPBOX_EXPORT_FOLDER}/daily`), today, KEEP_DAILY_DAYS);
    for (const name of expired) await dropbox.remove(`${DROPBOX_EXPORT_FOLDER}/daily/${name}`);
    const counts = Object.fromEntries(Object.entries(payload).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).length]));
    await statusRef.set({ lastSuccessAt: startedAt.toISOString(), lastAttemptAt: startedAt.toISOString(), lastError: null, bytes: Buffer.byteLength(content), counts, prunedDailyFiles: expired.length, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logger.info('dropbox v3 backup uploaded', { bytes: Buffer.byteLength(content), counts, prunedDailyFiles: expired.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await statusRef.set({ lastAttemptAt: startedAt.toISOString(), lastError: message, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
    logger.error('dropbox v3 backup failed', { error: message });
    throw error;
  }
});
