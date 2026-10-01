// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as FirebaseAuth from 'firebase/auth';
import type * as Firestore from 'firebase/firestore';

/**
 * On a weak mobile connection the account refresh can simply fail. The device then still held the
 * state the session was created with — no authenticator — and sent staff to enrolment, where adding a
 * second authenticator fails too. A session that signed in with its authenticator says so in its own
 * token, which needs no network; and when nothing can be confirmed the app waits instead of guessing.
 */
const auth = vi.hoisted(() => ({
  reloads: 0,
  secondFactorClaim: 'totp' as string | undefined,
  reloadErrorCode: 'auth/network-request-failed',
}));

vi.mock('firebase/auth', async (importOriginal) => {
  const { FirebaseError } = await import('firebase/app');
  return {
  ...(await importOriginal<typeof FirebaseAuth>()),
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    queueMicrotask(() => callback({
      uid: 'staff-1', email: 'staff@example.com', displayName: 'Staff', emailVerified: true,
      getIdTokenResult: async () => ({ claims: { firebase: auth.secondFactorClaim ? { sign_in_second_factor: auth.secondFactorClaim } : {} } }),
    }));
    return () => undefined;
  },
  // The stored session predates enrolment, and the refresh that would reveal it cannot get through.
  reload: async () => { auth.reloads += 1; throw new FirebaseError(auth.reloadErrorCode, 'offline'); },
  multiFactor: () => ({ enrolledFactors: [], getSession: async () => ({}) }),
  TotpMultiFactorGenerator: { FACTOR_ID: 'totp', generateSecret: vi.fn() },
  signOut: vi.fn(),
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const { FirebaseError } = await import('firebase/app');
  return {
  ...(await importOriginal<typeof Firestore>()),
  doc: () => ({}),
  collection: () => ({}),
  getDocFromCache: async () => { throw new FirebaseError('unavailable', 'no cached copy'); },
  getDoc: async () => ({ exists: () => true, data: () => ({ active: true, roles: { 'property-main': 'front_desk' }, allowedPages: { 'property-main': ['rooms'] } }) }),
  onSnapshot: () => () => undefined,
  };
});

import { AuthGate } from '../src/auth/AuthGate.js';
import type { FirebaseClient } from '../src/firebase-client.js';
import { LocaleProvider } from '../src/i18n/locale.js';

afterEach(cleanup);

const client = { auth: {}, db: {}, functions: {}, propertyId: 'property-main' } as unknown as FirebaseClient;

describe('a weak connection during the session check', () => {
  it('trusts the token that proves the authenticator, without any refresh', async () => {
    auth.secondFactorClaim = 'totp';
    auth.reloads = 0;
    render(<LocaleProvider initialLocale="zh-TW"><AuthGate client={client} /></LocaleProvider>);

    expect(await screen.findByRole('heading', { name: '今日營運' })).toBeInTheDocument();
    expect(auth.reloads).toBe(0);
    expect(screen.queryByRole('heading', { name: '設定驗證器' })).not.toBeInTheDocument();
  });

  it('waits and offers a retry instead of sending staff to authenticator setup', async () => {
    auth.secondFactorClaim = undefined;
    render(<LocaleProvider initialLocale="zh-TW"><AuthGate client={client} /></LocaleProvider>);

    expect(await screen.findByRole('heading', { name: '連線不穩' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '設定驗證器' })).not.toBeInTheDocument();
    // Still signed in: the way out is to retry, not to type a password again.
    expect(screen.getByRole('button', { name: '再試一次' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
    expect(await screen.findByRole('heading', { name: '連線不穩' })).toBeInTheDocument();
  });
});
