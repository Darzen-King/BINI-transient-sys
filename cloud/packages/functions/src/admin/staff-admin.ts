import {
  CLOUD_ROLES,
  staffCreateInputSchema,
  staffListInputSchema,
  staffResetMfaInputSchema,
  staffSetPasswordInputSchema,
  staffUpdateInputSchema,
  type CloudPageId,
  type StaffDirectoryEntry,
} from '@bini/cloud-shared';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { allowedPagesForProperty, hasPagePermission, hasVerifiedMfaClaims, mfaResetRefusal, roleForProperty } from './staff-access.js';

// Callables must be publicly invokable at the Cloud Run layer; each handler still verifies Firebase Auth, MFA and role.
// Stated explicitly because these functions were first created by a failed deploy and never received the invoker binding.
const callableOptions = { region: 'asia-east1', invoker: 'public' } as const;

function invalidInput(): never {
  throw new HttpsError('invalid-argument', '輸入資料格式不正確。');
}

export async function requirePropertyAdmin(
  auth: { uid: string; token: unknown } | undefined,
  propertyId: string,
): Promise<string> {
  if (!auth) throw new HttpsError('unauthenticated', '請先登入。');
  if (!hasVerifiedMfaClaims(auth.token)) {
    throw new HttpsError('permission-denied', '必須完成電子郵件驗證與 MFA 登入。');
  }
  const profile = await getFirestore().doc(`users/${auth.uid}`).get();
  if (roleForProperty(profile.data(), propertyId) !== 'admin') {
    throw new HttpsError('permission-denied', '只有管理員可執行此操作。');
  }
  return auth.uid;
}

/** MFA, active-property membership and the administrator-configured page allowlist. */
export async function requirePropertyPage(
  auth: { uid: string; token: unknown } | undefined,
  propertyId: string,
  pageId: CloudPageId,
): Promise<string> {
  if (!auth) throw new HttpsError('unauthenticated', '請先登入。');
  if (!hasVerifiedMfaClaims(auth.token)) {
    throw new HttpsError('permission-denied', '必須完成電子郵件驗證與 MFA 登入。');
  }
  const profile = await getFirestore().doc(`users/${auth.uid}`).get();
  if (!hasPagePermission(profile.data(), propertyId, pageId)) {
    throw new HttpsError('permission-denied', '此帳號沒有此頁面的操作權限。');
  }
  return auth.uid;
}

export async function writeAudit(
  propertyId: string,
  actorUid: string,
  action: string,
  targetUid: string,
  details: Record<string, unknown>,
): Promise<void> {
  await getFirestore().collection(`properties/${propertyId}/auditLogs`).add({
    actorUid,
    action,
    targetUid,
    details,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function configuredRoleForProperty(profile: Record<string, unknown>, propertyId: string) {
  const roles = profile.roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return null;
  const role = (roles as Record<string, unknown>)[propertyId];
  return typeof role === 'string' && CLOUD_ROLES.includes(role as (typeof CLOUD_ROLES)[number])
    ? role as (typeof CLOUD_ROLES)[number]
    : null;
}

export const adminListStaff = onCall(callableOptions, async (request) => {
  const parsed = staffListInputSchema.safeParse(request.data);
  if (!parsed.success) return invalidInput();
  await requirePropertyAdmin(request.auth, parsed.data.propertyId);

  const profiles = await getFirestore().collection('users').get();
  const entries = await Promise.all(profiles.docs.map(async (profileDoc): Promise<StaffDirectoryEntry | null> => {
    const profile = profileDoc.data();
    const role = configuredRoleForProperty(profile, parsed.data.propertyId);
    if (!role) return null;
    try {
      const authUser = await getAuth().getUser(profileDoc.id);
      return {
        uid: authUser.uid,
        email: authUser.email ?? String(profile.email ?? ''),
        displayName: authUser.displayName ?? String(profile.displayName ?? ''),
        role,
        active: profile.active === true && !authUser.disabled,
        allowedPages: allowedPagesForProperty(profile, parsed.data.propertyId),
        lastLoginAt: authUser.metadata.lastSignInTime ?? null,
        mfaEnrolled: (authUser.multiFactor?.enrolledFactors.length ?? 0) > 0,
      };
    } catch {
      return null;
    }
  }));

  return {
    users: entries.filter((entry): entry is StaffDirectoryEntry => entry !== null)
      .sort((left, right) => left.email.localeCompare(right.email)),
  };
});

export const adminCreateStaff = onCall(callableOptions, async (request) => {
  const parsed = staffCreateInputSchema.safeParse(request.data);
  if (!parsed.success) return invalidInput();
  const actorUid = await requirePropertyAdmin(request.auth, parsed.data.propertyId);

  const auth = getAuth();
  let createdUid: string | null = null;
  try {
    const account = await auth.createUser({
      email: parsed.data.email,
      emailVerified: false,
      password: parsed.data.password,
      displayName: parsed.data.displayName,
      disabled: false,
    });
    createdUid = account.uid;
    await getFirestore().doc(`users/${account.uid}`).set({
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      active: true,
      roles: { [parsed.data.propertyId]: parsed.data.role },
      allowedPages: { [parsed.data.propertyId]: parsed.data.allowedPages },
      mfaRequired: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writeAudit(parsed.data.propertyId, actorUid, 'staff.create', account.uid, {
      email: parsed.data.email,
      role: parsed.data.role,
      allowedPages: parsed.data.allowedPages,
    });
    return { uid: account.uid };
  } catch (error) {
    if (createdUid) await auth.deleteUser(createdUid).catch(() => undefined);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('already-exists', '帳號可能已存在，或無法建立。');
  }
});

export const adminUpdateStaff = onCall(callableOptions, async (request) => {
  const parsed = staffUpdateInputSchema.safeParse(request.data);
  if (!parsed.success) return invalidInput();
  const actorUid = await requirePropertyAdmin(request.auth, parsed.data.propertyId);
  if (actorUid === parsed.data.uid && (!parsed.data.active || parsed.data.role !== 'admin')) {
    throw new HttpsError('failed-precondition', '不可停用或移除自己的管理員身分。');
  }

  const auth = getAuth();
  const authBefore = await auth.getUser(parsed.data.uid).catch(() => {
    throw new HttpsError('not-found', '找不到人員帳號。');
  });
  const previousEmail = authBefore.email ?? '';
  const changingEmail = previousEmail.toLowerCase() !== parsed.data.email;
  if (actorUid === parsed.data.uid && changingEmail) {
    throw new HttpsError('failed-precondition', '不可變更自己的登入帳號。');
  }

  const profileRef = getFirestore().doc(`users/${parsed.data.uid}`);
  const profileBefore = await profileRef.get();
  if (!profileBefore.exists) throw new HttpsError('not-found', '找不到人員帳號。');
  let authUpdated = false;
  try {
    await auth.updateUser(parsed.data.uid, {
      displayName: parsed.data.displayName,
      disabled: !parsed.data.active,
      ...(changingEmail ? { email: parsed.data.email, emailVerified: false } : {}),
    });
    authUpdated = true;
    await getFirestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(profileRef);
      if (!snapshot.exists) throw new HttpsError('not-found', '找不到人員帳號。');
      const existing = snapshot.data() ?? {};
      const existingRoles = typeof existing.roles === 'object' && existing.roles !== null
        ? existing.roles as Record<string, unknown>
        : {};
      const existingPages = typeof existing.allowedPages === 'object' && existing.allowedPages !== null
        ? existing.allowedPages as Record<string, unknown>
        : {};
      transaction.set(profileRef, {
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        active: parsed.data.active,
        roles: { ...existingRoles, [parsed.data.propertyId]: parsed.data.role },
        allowedPages: { ...existingPages, [parsed.data.propertyId]: parsed.data.allowedPages },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } catch (error) {
    if (authUpdated) {
      await auth.updateUser(parsed.data.uid, {
        displayName: authBefore.displayName ?? null,
        disabled: authBefore.disabled,
        ...(changingEmail && previousEmail ? { email: previousEmail, emailVerified: authBefore.emailVerified } : {}),
      }).catch(() => undefined);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', '更新人員帳號失敗。');
  }
  await writeAudit(parsed.data.propertyId, actorUid, 'staff.update', parsed.data.uid, {
    email: parsed.data.email,
    emailChanged: changingEmail,
    role: parsed.data.role,
    active: parsed.data.active,
    allowedPages: parsed.data.allowedPages,
  });
  return { ok: true };
});

export const adminSetStaffPassword = onCall(callableOptions, async (request) => {
  const parsed = staffSetPasswordInputSchema.safeParse(request.data);
  if (!parsed.success) return invalidInput();
  const actorUid = await requirePropertyAdmin(request.auth, parsed.data.propertyId);
  await getAuth().updateUser(parsed.data.uid, { password: parsed.data.password });
  await getAuth().revokeRefreshTokens(parsed.data.uid);
  await writeAudit(parsed.data.propertyId, actorUid, 'staff.password_reset', parsed.data.uid, {});
  return { ok: true };
});

/** Clears a staff member's authenticator and signs them out everywhere; their next password sign-in enrols a new one. */
export const adminResetStaffMfa = onCall(callableOptions, async (request) => {
  const parsed = staffResetMfaInputSchema.safeParse(request.data);
  if (!parsed.success) return invalidInput();
  const actorUid = await requirePropertyAdmin(request.auth, parsed.data.propertyId);
  const target = await getFirestore().doc(`users/${parsed.data.uid}`).get();
  const refusal = mfaResetRefusal(actorUid, parsed.data.uid, target.data(), parsed.data.propertyId);
  if (refusal === 'self') throw new HttpsError('failed-precondition', '不可重設自己的兩步驟驗證。');
  if (refusal === 'not-member') throw new HttpsError('not-found', '此館別找不到這位人員。');
  const auth = getAuth();
  const before = await auth.getUser(parsed.data.uid).catch(() => {
    throw new HttpsError('not-found', '找不到人員帳號。');
  });
  const clearedFactors = before.multiFactor?.enrolledFactors.length ?? 0;
  await auth.updateUser(parsed.data.uid, { multiFactor: { enrolledFactors: null } });
  await auth.revokeRefreshTokens(parsed.data.uid);
  await writeAudit(parsed.data.propertyId, actorUid, 'staff.mfa_reset', parsed.data.uid, { reason: parsed.data.reason, clearedFactors });
  return { ok: true };
});
