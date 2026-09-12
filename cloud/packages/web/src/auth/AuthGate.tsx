import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { FirebaseError } from 'firebase/app';
import {
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  multiFactor,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  type MultiFactorResolver,
  type MultiFactorError,
  type TotpSecret,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { CLOUD_ROLES, type CloudPageId, type CloudRole } from '@bini/cloud-shared';

import { App } from '../App.js';
import { createAccountAdminGateway } from '../accounts/account-admin.js';
import { Button, Field, Notice } from '../design-system/index.js';
import type { FirebaseClient } from '../firebase-client.js';
import { LanguageSwitcher, useLocale } from '../i18n/locale.js';
import { createDataImportGateway } from '../migration/data-import.js';
import { createBookingListGateway } from '../bookings/booking-list.js';
import { createBookingCancelGateway } from '../bookings/booking-cancel.js';
import { createBookingCreateGateway } from '../bookings/booking-create.js';
import { createBookingUpdateGateway } from '../bookings/booking-update.js';
import { createBookingSoonGateway } from '../bookings/booking-soon.js';
import { createRoomOverviewGateway } from '../rooms/room-overview.js';
import { createBookingRoomGateway } from '../rooms/booking-room-options.js';
import { createStayCheckInGateway } from '../stays/stay-checkin.js';
import { createStayExtendGateway } from '../stays/stay-extend.js';
import { createActiveStaysGateway } from '../stays/active-stays.js';
import { createHolidayCalendarGateway } from '../stays/holiday-calendar.js';
import { createStayCheckoutGateway } from '../stays/stay-checkout.js';
import { createPaymentCreateGateway } from '../payments/payment-create.js';
import { createPaymentListGateway } from '../payments/payment-list.js';
import { createHousekeepingGateway } from '../housekeeping/housekeeping-gateway.js';
import { createMaintenanceGateway } from '../maintenance/maintenance-gateway.js';
import { createRoomManagementGateway } from '../room-management/room-management-gateway.js';
import { createRoomTimelineGateway } from '../gantt/room-timeline-gateway.js';
import type { StaffSession } from './session.js';

type GatePhase = 'loading' | 'login' | 'mfa' | 'verify-email' | 'enroll-mfa' | 'blocked' | 'ready';

function AuthCard({ children }: { children: ReactNode }) {
  return <main className="login-page"><section className="login-card"><LanguageSwitcher className="auth-language-switch" /><img className="brand-wordmark" src="/bini-blooms-logo.png" alt="BINI Blooms" />{children}</section></main>;
}

function friendlyError(error: unknown, text: (zhTw: string, en: string) => string): string {
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/invalid-verification-code') return text('驗證碼錯誤，請重新輸入。', 'The verification code is incorrect. Try again.');
    if (error.code === 'auth/too-many-requests') return text('嘗試次數過多，請稍後再試。', 'Too many attempts. Try again later.');
  }
  return text('登入資料不正確，或帳號目前無法使用。', 'The sign-in details are incorrect, or this account is unavailable.');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseProfile(user: User, propertyId: string, profile: Record<string, unknown>): StaffSession | null {
  if (profile.active !== true) return null;
  const roles = asRecord(profile.roles);
  const role = roles?.[propertyId];
  if (typeof role !== 'string' || !CLOUD_ROLES.includes(role as CloudRole)) return null;
  const pageMap = asRecord(profile.allowedPages);
  const rawPages = pageMap?.[propertyId];
  const allowedPages = Array.isArray(rawPages)
    ? rawPages.filter((page): page is CloudPageId => typeof page === 'string')
    : [];
  return {
    uid: user.uid,
    email: user.email ?? String(profile.email ?? ''),
    displayName: user.displayName ?? String(profile.displayName ?? user.email ?? ''),
    propertyId,
    role: role as CloudRole,
    allowedPages,
  };
}

export function AuthGate({ client }: { client: FirebaseClient }) {
  const { text } = useLocale();
  const [phase, setPhase] = useState<GatePhase>('loading');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [session, setSession] = useState<StaffSession | null>(null);
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [totpSecret, setTotpSecret] = useState<TotpSecret | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const bookingListGateway = useMemo(() => createBookingListGateway(client.db), [client.db]);
  const bookingCancelGateway = useMemo(() => createBookingCancelGateway(client.functions), [client.functions]);
  const bookingCreateGateway = useMemo(() => createBookingCreateGateway(client.functions), [client.functions]);
  const bookingUpdateGateway = useMemo(() => createBookingUpdateGateway(client.functions), [client.functions]);
  const bookingSoonGateway = useMemo(() => createBookingSoonGateway(client.db), [client.db]);
  const bookingRoomGateway = useMemo(() => createBookingRoomGateway(client.db), [client.db]);
  const roomOverviewGateway = useMemo(() => createRoomOverviewGateway(client.db), [client.db]);
  const stayCheckInGateway = useMemo(() => createStayCheckInGateway(client.functions), [client.functions]);
  const stayExtendGateway = useMemo(() => createStayExtendGateway(client.functions), [client.functions]);
  const activeStaysGateway = useMemo(() => createActiveStaysGateway(client.db), [client.db]);
  const holidayCalendarGateway = useMemo(() => createHolidayCalendarGateway(client.db), [client.db]);
  const stayCheckoutGateway = useMemo(() => createStayCheckoutGateway(client.functions), [client.functions]);
  const paymentCreateGateway = useMemo(() => createPaymentCreateGateway(client.functions), [client.functions]);
  const paymentListGateway = useMemo(() => createPaymentListGateway(client.db), [client.db]);
  const housekeepingGateway = useMemo(() => createHousekeepingGateway(client.db, client.functions), [client.db, client.functions]);
  const maintenanceGateway = useMemo(() => createMaintenanceGateway(client.db, client.functions), [client.db, client.functions]);
  const roomManagementGateway = useMemo(() => createRoomManagementGateway(client.db, client.functions), [client.db, client.functions]);
  const roomTimelineGateway = useMemo(() => createRoomTimelineGateway(client.db), [client.db]);

  const evaluateUser = useCallback(async (user: User) => {
    setCurrentUser(user);
    setSession(null);
    setTotpSecret(null);
    setError('');
    if (!user.emailVerified) {
      setPhase('verify-email');
      return;
    }
    if (multiFactor(user).enrolledFactors.length === 0) {
      setPhase('enroll-mfa');
      return;
    }
    const token = await user.getIdTokenResult();
    const firebaseClaim = asRecord(token.claims.firebase);
    if (typeof firebaseClaim?.sign_in_second_factor !== 'string') {
      await signOut(client.auth);
      setNotice(text('請重新登入並輸入驗證器代碼。', 'Sign in again and enter your authenticator code.'));
      setPhase('login');
      return;
    }
    const snapshot = await getDoc(doc(client.db, 'users', user.uid));
    const nextSession = snapshot.exists() ? parseProfile(user, client.propertyId, snapshot.data()) : null;
    if (!nextSession) {
      setPhase('blocked');
      return;
    }
    setSession(nextSession);
    setPhase('ready');
  }, [client.auth, client.db, client.propertyId, text]);

  useEffect(() => onAuthStateChanged(client.auth, (user) => {
    if (!user) {
      setCurrentUser(null);
      setSession(null);
      setPhase((current) => current === 'mfa' ? current : 'login');
      return;
    }
    void evaluateUser(user).catch((evaluateError: unknown) => {
      setError(friendlyError(evaluateError, text));
      setPhase('blocked');
    });
  }), [client.auth, evaluateUser]);

  useEffect(() => {
    if (phase !== 'enroll-mfa' || !currentUser || totpSecret) return;
    void (async () => {
      try {
        const mfaSession = await multiFactor(currentUser).getSession();
        setTotpSecret(await TotpMultiFactorGenerator.generateSecret(mfaSession));
      } catch (secretError) {
        setError(friendlyError(secretError, text));
      }
    })();
  }, [currentUser, phase, text, totpSecret]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await signInWithEmailAndPassword(client.auth, String(data.get('email')), String(data.get('password')));
    } catch (loginError) {
      if (loginError instanceof FirebaseError && loginError.code === 'auth/multi-factor-auth-required') {
        setResolver(getMultiFactorResolver(client.auth, loginError as MultiFactorError));
        setPhase('mfa');
      } else {
        setError(friendlyError(loginError, text));
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolver) return;
    const code = String(new FormData(event.currentTarget).get('code'));
    const hint = resolver.hints.find((item) => item.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!hint) {
      setError(text('此帳號尚未設定支援的驗證器。', 'This account does not have a supported authenticator.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
      await resolver.resolveSignIn(assertion);
      setResolver(null);
    } catch (mfaError) {
      setError(friendlyError(mfaError, text));
    } finally {
      setBusy(false);
    }
  };

  const enrollMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || !totpSecret) return;
    const code = String(new FormData(event.currentTarget).get('code'));
    setBusy(true);
    setError('');
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, code);
      await multiFactor(currentUser).enroll(assertion, text('BINI 驗證器', 'BINI Authenticator'));
      await signOut(client.auth);
      setNotice(text('MFA 設定完成，請重新登入。', 'MFA is ready. Sign in again.'));
      setPhase('login');
    } catch (enrollError) {
      setError(friendlyError(enrollError, text));
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'ready' && session) {
    return <App
      session={session}
      accountGateway={createAccountAdminGateway(client.functions)}
      dataImportGateway={createDataImportGateway(client.functions)}
      bookingListGateway={bookingListGateway}
      bookingCancelGateway={bookingCancelGateway}
      bookingCreateGateway={bookingCreateGateway}
      bookingUpdateGateway={bookingUpdateGateway}
      bookingSoonGateway={bookingSoonGateway}
      bookingRoomGateway={bookingRoomGateway}
      roomOverviewGateway={roomOverviewGateway}
      roomTimelineGateway={roomTimelineGateway}
      stayCheckInGateway={stayCheckInGateway}
      stayExtendGateway={stayExtendGateway}
      activeStaysGateway={activeStaysGateway}
      holidayCalendarGateway={holidayCalendarGateway}
      stayCheckoutGateway={stayCheckoutGateway}
      paymentCreateGateway={paymentCreateGateway}
      paymentListGateway={paymentListGateway}
      housekeepingGateway={housekeepingGateway}
      maintenanceGateway={maintenanceGateway}
      roomManagementGateway={roomManagementGateway}
      onLogout={() => signOut(client.auth)}
    />;
  }

  if (phase === 'loading') return <AuthCard><p>{text('正在確認登入狀態…', 'Checking your session…')}</p></AuthCard>;

  if (phase === 'mfa') return (
    <AuthCard>
      <h1>{text('兩步驟驗證', 'Two-step verification')}</h1><p>{text('輸入驗證器 App 顯示的 6 位數代碼。', 'Enter the 6-digit code from your authenticator app.')}</p>
      {error ? <Notice tone="danger" title={text('驗證失敗', 'Verification failed')}>{error}</Notice> : null}
      <form onSubmit={(event) => void verifyMfa(event)}><Field label={text('驗證碼', 'Verification code')}><input name="code" required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" /></Field><Button block loading={busy} size="lg" type="submit">{text('完成登入', 'Complete sign in')}</Button></form>
      <Button block onClick={() => { setResolver(null); setPhase('login'); }} variant="ghost">{text('返回登入', 'Back to sign in')}</Button>
    </AuthCard>
  );

  if (phase === 'verify-email' && currentUser) return (
    <AuthCard>
      <h1>{text('驗證電子郵件', 'Verify your email')}</h1><p>{text(`首次登入前需驗證 ${currentUser.email}。`, `Verify ${currentUser.email} before your first sign in.`)}</p>
      {notice ? <Notice tone="success" title={notice} /> : null}{error ? <Notice tone="danger" title={text('驗證失敗', 'Verification failed')}>{error}</Notice> : null}
      <Button block onClick={() => void sendEmailVerification(currentUser).then(() => setNotice(text('驗證信已寄出。', 'Verification email sent.'))).catch((sendError: unknown) => setError(friendlyError(sendError, text)))} size="lg">{text('寄送驗證信', 'Send verification email')}</Button>
      <Button block onClick={() => void reload(currentUser).then(() => evaluateUser(currentUser)).catch((reloadError: unknown) => setError(friendlyError(reloadError, text)))} variant="outline">{text('我已完成驗證', 'I have verified my email')}</Button>
      <Button block onClick={() => void signOut(client.auth)} variant="ghost">{text('登出', 'Sign out')}</Button>
    </AuthCard>
  );

  if (phase === 'enroll-mfa' && currentUser) return (
    <AuthCard>
      <h1>{text('設定驗證器', 'Set up an authenticator')}</h1><p>{text('用 Google Authenticator、Microsoft Authenticator 或相容 App 加入帳號。', 'Add this account to Google Authenticator, Microsoft Authenticator, or a compatible app.')}</p>
      {totpSecret ? <>
        <a className="authenticator-link" href={totpSecret.generateQrCodeUrl(currentUser.email ?? 'staff', 'BINI PMS')}>{text('在此裝置開啟驗證器', 'Open authenticator on this device')}</a>
        <p>{text('若目前使用電腦，請在手機驗證器選擇「輸入設定金鑰」，類型選「依時間」。', 'On a computer, choose Enter setup key in the phone app and select Time based.')}</p>
        <code className="secret-key">{totpSecret.secretKey}</code>
        <Notice tone="warning" title={text('保護此金鑰', 'Protect this key')}>{text('此金鑰等同第二道密碼，請勿截圖、分享或傳送給其他人。', 'Treat this key like a second password. Do not screenshot, share, or send it.')}</Notice>
      </> : <p>{text('正在產生驗證金鑰…', 'Generating your setup key…')}</p>}
      {error ? <Notice tone="danger" title={text('設定失敗', 'Setup failed')}>{error}</Notice> : null}
      <form onSubmit={(event) => void enrollMfa(event)}><Field label={text('驗證器代碼', 'Authenticator code')}><input name="code" required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" /></Field><Button block disabled={!totpSecret} loading={busy} size="lg" type="submit">{text('完成 MFA 設定', 'Complete MFA setup')}</Button></form>
    </AuthCard>
  );

  if (phase === 'blocked') return (
    <AuthCard><h1>{text('帳號無法使用', 'Account unavailable')}</h1><p>{text('此帳號尚未指派到館別、已停用，或資料尚未完成設定。請聯絡管理員。', 'This account is inactive, not assigned to a property, or incomplete. Contact an administrator.')}</p>{error ? <Notice tone="danger" title={text('無法登入', 'Unable to sign in')}>{error}</Notice> : null}<Button block onClick={() => void signOut(client.auth)} variant="outline">{text('返回登入', 'Back to sign in')}</Button></AuthCard>
  );

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={(event) => void login(event)}>
        <LanguageSwitcher className="auth-language-switch" />
        <img className="brand-wordmark" src="/bini-blooms-logo.png" alt="BINI Blooms" />
        <h1>{text('員工登入', 'Staff sign in')}</h1><p>{text('僅限管理員已建立的 BINI PMS 帳號', 'Only administrator-created BINI PMS accounts may sign in')}</p>
        {notice ? <Notice tone="success" title={notice} /> : null}{error ? <Notice tone="danger" title={text('登入失敗', 'Sign-in failed')}>{error}</Notice> : null}
        <Field label={text('電子郵件', 'Email')}><input required name="email" type="email" autoComplete="username" /></Field>
        <Field label={text('密碼', 'Password')}><input required name="password" type="password" autoComplete="current-password" /></Field>
        <Button block loading={busy} size="lg" type="submit">{text('安全登入', 'Secure sign in')}</Button>
      </form>
    </main>
  );
}
