import { pushTokenRegisterInputSchema, pushTokenUnregisterInputSchema, type PushTestSendResult } from '@bini/cloud-shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { hasVerifiedMfaClaims, roleForProperty } from '../admin/staff-access.js';
import { pushTokenDocId } from './push-plan.js';
import { sendPush, tokensForUids } from './push-send.js';

const callableOptions = { region: 'asia-east1', invoker: 'public' } as const;

/** Signed in with MFA and active on at least one property; reminders are sent per property membership. */
async function requireActiveStaff(auth: { uid: string; token: unknown } | undefined): Promise<string> {
  if (!auth) throw new HttpsError('unauthenticated', '請先登入。');
  if (!hasVerifiedMfaClaims(auth.token)) throw new HttpsError('permission-denied', '必須完成電子郵件驗證與 MFA 登入。');
  const profile = (await getFirestore().doc(`users/${auth.uid}`).get()).data();
  const roles = profile?.roles;
  const propertyIds = roles && typeof roles === 'object' ? Object.keys(roles as Record<string, unknown>) : [];
  if (!propertyIds.some((propertyId) => roleForProperty(profile, propertyId) !== null)) throw new HttpsError('permission-denied', '此帳號目前沒有可用的館別權限。');
  return auth.uid;
}

/** Binds this device's FCM token to the signed-in account (a shared phone follows whoever signed in last). */
export const pushTokenRegister = onCall(callableOptions, async (request) => {
  const uid = await requireActiveStaff(request.auth);
  const parsed = pushTokenRegisterInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '輸入資料格式不正確。');
  const ref = getFirestore().doc(`pushTokens/${pushTokenDocId(parsed.data.token)}`);
  await getFirestore().runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    transaction.set(ref, {
      uid,
      token: parsed.data.token,
      platform: parsed.data.platform,
      createdAt: existing.exists ? existing.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { registered: true };
});

export const pushTokenUnregister = onCall(callableOptions, async (request) => {
  const uid = await requireActiveStaff(request.auth);
  const parsed = pushTokenUnregisterInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '輸入資料格式不正確。');
  const ref = getFirestore().doc(`pushTokens/${pushTokenDocId(parsed.data.token)}`);
  const snapshot = await ref.get();
  if (snapshot.exists && snapshot.data()?.uid === uid) await ref.delete();
  return { unregistered: true };
});

/** Sends a test notification to every device registered to the caller, so staff can confirm setup. */
export const pushTestSend = onCall(callableOptions, async (request): Promise<PushTestSendResult> => {
  const uid = await requireActiveStaff(request.auth);
  const tokens = await tokensForUids([uid]);
  if (!tokens.length) throw new HttpsError('failed-precondition', '此帳號尚未有已開啟通知的裝置。');
  return sendPush(tokens, { title: 'BINI PMS 測試通知', body: '通知設定完成，即將入住與即將退房時會收到提醒。', tag: `test-${Date.now()}`, kind: 'test' });
});
