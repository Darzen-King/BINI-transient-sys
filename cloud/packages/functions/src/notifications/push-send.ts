import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions/v2';

import { chunk, staleTokenIndexes } from './push-plan.js';

export interface PushPayload {
  title: string;
  body: string;
  /** Same tag replaces an earlier notification for the same event instead of stacking. */
  tag: string;
  kind: string;
  roomId?: string;
}

interface TokenRecord { id: string; token: string }

export async function tokensForUids(uids: readonly string[]): Promise<TokenRecord[]> {
  const db = getFirestore();
  const records: TokenRecord[] = [];
  for (const group of chunk(uids, 30)) {
    const snapshot = await db.collection('pushTokens').where('uid', 'in', group).get();
    for (const document of snapshot.docs) {
      const token = document.data().token;
      if (typeof token === 'string' && token) records.push({ id: document.id, token });
    }
  }
  return records;
}

/**
 * Data-only web push: the app's own service worker (`sw.js`) shows the notification, so the same code path works
 * for installed iPhone home-screen apps, Android and desktop browsers. Tokens FCM reports as gone are removed.
 */
export async function sendPush(tokens: readonly TokenRecord[], payload: PushPayload): Promise<{ sentCount: number; failedCount: number }> {
  let sentCount = 0;
  let failedCount = 0;
  const db = getFirestore();
  for (const group of chunk(tokens, 500)) {
    const response = await getMessaging().sendEachForMulticast({
      tokens: group.map((record) => record.token),
      data: { title: payload.title, body: payload.body, tag: payload.tag, kind: payload.kind, roomId: payload.roomId ?? '', url: '/' },
      webpush: { headers: { Urgency: 'high', TTL: '900' } },
    });
    sentCount += response.successCount;
    failedCount += response.failureCount;
    const stale = staleTokenIndexes(response.responses.map((item) => ({ success: item.success, error: item.error ? { code: item.error.code } : undefined })));
    await Promise.all(stale.map((index) => db.doc(`pushTokens/${group[index]!.id}`).delete()));
    if (stale.length) logger.info('removed stale push tokens', { count: stale.length });
  }
  return { sentCount, failedCount };
}
