import { planPushReminders } from '@bini/cloud-shared';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { propertyRecipientUids, reminderSources } from './push-plan.js';
import { sendPush, tokensForUids } from './push-send.js';

const ALREADY_EXISTS = 6;

/**
 * Background version of the in-app reminders: every minute, arrivals and check-outs entering v3's 15-minute window are
 * pushed once to every active staff member of the property, so phones are notified even when the app is closed.
 * A log document created per reminder key makes each event notify at most once, even if runs overlap.
 */
export const pushReminders = onSchedule({ schedule: '* * * * *', timeZone: 'Asia/Taipei', region: 'asia-east1', timeoutSeconds: 120, memory: '256MiB', maxInstances: 1, retryCount: 0 }, async () => {
  const db = getFirestore();
  const nowMillis = Date.now();
  const properties = (await db.collection('properties').get()).docs.filter((property) => {
    const data = property.data();
    const legacy = data.legacyV3Import as { active?: unknown } | undefined;
    return data.active !== false && legacy?.active !== false;
  });
  let users: { id: string; data: unknown }[] | null = null;
  for (const property of properties) {
    const root = `properties/${property.id}`;
    try {
      const [bookings, stays] = await Promise.all([
        db.collection(`${root}/bookings`).where('status', '==', '已預約').get(),
        db.collection(`${root}/stays`).get(),
      ]);
      const sources = reminderSources(bookings.docs.map((document) => ({ id: document.id, data: document.data() })), stays.docs.map((document) => ({ id: document.id, data: document.data() })), nowMillis);
      if (sources.skipped.length) logger.warn('push reminders skipped malformed documents', { propertyId: property.id, skipped: sources.skipped });
      const label = properties.length > 1 && typeof property.data().name === 'string' ? property.data().name as string : null;
      const reminders = planPushReminders(sources.bookings, sources.checkouts, label);
      if (!reminders.length) continue;

      const fresh = [];
      for (const reminder of reminders) {
        try {
          await db.doc(`${root}/pushReminderLog/${reminder.key}`).create({ kind: reminder.kind, targetId: reminder.targetId, roomId: reminder.roomId, title: reminder.title, body: reminder.body, createdAt: new Date(nowMillis).toISOString() });
          fresh.push(reminder);
        } catch (error) {
          if ((error as { code?: unknown }).code !== ALREADY_EXISTS) throw error;
        }
      }
      if (!fresh.length) continue;

      users ??= (await db.collection('users').where('active', '==', true).get()).docs.map((document) => ({ id: document.id, data: document.data() }));
      const tokens = await tokensForUids(propertyRecipientUids(users, property.id));
      for (const reminder of fresh) {
        const result = tokens.length ? await sendPush(tokens, { title: reminder.title, body: reminder.body, tag: reminder.key, kind: reminder.kind, roomId: reminder.roomId }) : { sentCount: 0, failedCount: 0 };
        await db.doc(`${root}/pushReminderLog/${reminder.key}`).update({ sentCount: result.sentCount, failedCount: result.failedCount });
        logger.info('push reminder sent', { propertyId: property.id, key: reminder.key, ...result });
      }
    } catch (error) {
      // One property failing must not stop the others; unsent reminders without a log document retry next minute.
      logger.error('push reminders failed', { propertyId: property.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
});
