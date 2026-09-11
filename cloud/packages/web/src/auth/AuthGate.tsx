import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
import type { FirebaseClient } from '../firebase-client.js';
import { createDataImportGateway } from '../migration/data-import.js';
import type { StaffSession } from './session.js';

type GatePhase = 'loading' | 'login' | 'mfa' | 'verify-email' | 'enroll-mfa' | 'blocked' | 'ready';

function AuthCard({ children }: { children: ReactNode }) {
  return <main className="login-page"><section className="login-card"><img src="/bini-mark.svg" alt="BINI Blooms" />{children}</section></main>;
}

function friendlyError(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/invalid-verification-code') return '驗證碼錯誤，請重新輸入。';
    if (error.code === 'auth/too-many-requests') return '嘗試次數過多，請稍後再試。';
  }
  return '登入資料不正確，或帳號目前無法使用。';
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
  const [phase, setPhase] = useState<GatePhase>('loading');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [session, setSession] = useState<StaffSession | null>(null);
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [totpSecret, setTotpSecret] = useState<TotpSecret | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

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
      setNotice('請重新登入並輸入驗證器代碼。');
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
  }, [client.auth, client.db, client.propertyId]);

  useEffect(() => onAuthStateChanged(client.auth, (user) => {
    if (!user) {
      setCurrentUser(null);
      setSession(null);
      setPhase((current) => current === 'mfa' ? current : 'login');
      return;
    }
    void evaluateUser(user).catch((evaluateError: unknown) => {
      setError(friendlyError(evaluateError));
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
        setError(friendlyError(secretError));
      }
    })();
  }, [currentUser, phase, totpSecret]);

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
        setError(friendlyError(loginError));
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
      setError('此帳號尚未設定支援的驗證器。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
      await resolver.resolveSignIn(assertion);
      setResolver(null);
    } catch (mfaError) {
      setError(friendlyError(mfaError));
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
      await multiFactor(currentUser).enroll(assertion, 'BINI 驗證器');
      await signOut(client.auth);
      setNotice('MFA 設定完成，請重新登入。');
      setPhase('login');
    } catch (enrollError) {
      setError(friendlyError(enrollError));
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'ready' && session) {
    return <App
      session={session}
      accountGateway={createAccountAdminGateway(client.functions)}
      dataImportGateway={createDataImportGateway(client.functions)}
      onLogout={() => signOut(client.auth)}
    />;
  }

  if (phase === 'loading') return <AuthCard><p>正在確認登入狀態…</p></AuthCard>;

  if (phase === 'mfa') return (
    <AuthCard>
      <h1>兩步驟驗證</h1><p>輸入驗證器 App 顯示的 6 位數代碼。</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <form onSubmit={(event) => void verifyMfa(event)}><label>驗證碼<input name="code" required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" /></label><button className="wide-primary" disabled={busy}>{busy ? '驗證中…' : '完成登入'}</button></form>
      <button className="text-button" onClick={() => { setResolver(null); setPhase('login'); }}>返回登入</button>
    </AuthCard>
  );

  if (phase === 'verify-email' && currentUser) return (
    <AuthCard>
      <h1>驗證電子郵件</h1><p>首次登入前需驗證 {currentUser.email}。</p>
      {notice ? <p className="form-notice">{notice}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="wide-primary" onClick={() => void sendEmailVerification(currentUser).then(() => setNotice('驗證信已寄出。')).catch((sendError: unknown) => setError(friendlyError(sendError)))}>寄送驗證信</button>
      <button className="outline-button full-width" onClick={() => void reload(currentUser).then(() => evaluateUser(currentUser)).catch((reloadError: unknown) => setError(friendlyError(reloadError)))}>我已完成驗證</button>
      <button className="text-button" onClick={() => void signOut(client.auth)}>登出</button>
    </AuthCard>
  );

  if (phase === 'enroll-mfa' && currentUser) return (
    <AuthCard>
      <h1>設定驗證器</h1><p>用 Google Authenticator、Microsoft Authenticator 或相容 App 加入帳號。</p>
      {totpSecret ? <>
        <a className="authenticator-link" href={totpSecret.generateQrCodeUrl(currentUser.email ?? 'staff', 'BINI PMS')}>在此裝置開啟驗證器</a>
        <p>若目前使用電腦，請在手機驗證器選擇「輸入設定金鑰」，類型選「依時間」。</p>
        <code className="secret-key">{totpSecret.secretKey}</code>
        <p className="security-note">此金鑰等同第二道密碼，請勿截圖、分享或傳送給其他人。</p>
      </> : <p>正在產生驗證金鑰…</p>}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <form onSubmit={(event) => void enrollMfa(event)}><label>驗證器代碼<input name="code" required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" /></label><button className="wide-primary" disabled={busy || !totpSecret}>{busy ? '設定中…' : '完成 MFA 設定'}</button></form>
    </AuthCard>
  );

  if (phase === 'blocked') return (
    <AuthCard><h1>帳號無法使用</h1><p>此帳號尚未指派到館別、已停用，或資料尚未完成設定。請聯絡管理員。</p>{error ? <p className="form-error">{error}</p> : null}<button className="outline-button full-width" onClick={() => void signOut(client.auth)}>返回登入</button></AuthCard>
  );

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={(event) => void login(event)}>
        <img src="/bini-mark.svg" alt="BINI Blooms" />
        <h1>員工登入</h1><p>僅限管理員已建立的 BINI PMS 帳號</p>
        {notice ? <p className="form-notice">{notice}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
        <label>電子郵件<input required name="email" type="email" autoComplete="username" /></label>
        <label>密碼<input required name="password" type="password" autoComplete="current-password" /></label>
        <button className="wide-primary" disabled={busy} type="submit">{busy ? '登入中…' : '安全登入'}</button>
      </form>
    </main>
  );
}
