// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as FirebaseAuth from 'firebase/auth';
import type * as Firestore from 'firebase/firestore';

/**
 * A device that signed in before the authenticator was enrolled keeps that stored state: the user
 * reports no second factors until it is reloaded. Enrolment then fails, because Identity Platform
 * refuses a second authenticator — which is what staff saw as "設定失敗" on their phones.
 */
const auth = vi.hoisted(() => ({
  signedOut: false,
  reloads: 0,
  generateSecret: vi.fn(),
  user: {
    uid: 'staff-1',
    email: 'staff@example.com',
    displayName: 'Staff',
    emailVerified: true,
    factors: [] as Array<{ factorId: string }>,
    getIdTokenResult: async () => ({ claims: { firebase: {} } }),
  },
}));

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof FirebaseAuth>()),
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    queueMicrotask(() => callback(auth.user));
    return () => undefined;
  },
  // The server already holds one authenticator; only a reload reveals it to this device.
  reload: async () => { auth.reloads += 1; auth.user.factors = [{ factorId: 'totp' }]; },
  multiFactor: (user: typeof auth.user) => ({ enrolledFactors: user.factors, getSession: async () => ({}) }),
  TotpMultiFactorGenerator: { FACTOR_ID: 'totp', generateSecret: auth.generateSecret },
  signOut: async () => { auth.signedOut = true; },
}));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof Firestore>()),
  doc: () => ({}),
  collection: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ active: true, roles: { 'property-main': 'front_desk' }, allowedPages: { 'property-main': ['rooms'] } }) }),
  onSnapshot: () => () => undefined,
}));

import { AuthGate } from '../src/auth/AuthGate.js';
import type { FirebaseClient } from '../src/firebase-client.js';
import { LocaleProvider } from '../src/i18n/locale.js';

afterEach(cleanup);

describe('a stored session from before the authenticator was enrolled', () => {
  it('asks for the authenticator code instead of trying to enrol a second one', async () => {
    const client = { auth: {}, db: {}, functions: {}, propertyId: 'property-main' } as unknown as FirebaseClient;
    render(<LocaleProvider initialLocale="zh-TW"><AuthGate client={client} /></LocaleProvider>);

    expect(await screen.findByRole('heading', { name: '員工登入' })).toBeInTheDocument();
    await waitFor(() => expect(auth.signedOut).toBe(true));
    expect(auth.reloads).toBeGreaterThan(0);
    // Never reaches the enrolment screen, so the authenticator secret is never requested.
    expect(auth.generateSecret).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: '設定驗證器' })).not.toBeInTheDocument();
    expect(screen.getByText('請重新登入並輸入驗證器代碼。')).toBeInTheDocument();
  });
});
