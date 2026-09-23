// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as FirebaseAuth from 'firebase/auth';
import type * as Firestore from 'firebase/firestore';

/**
 * Opening the app on a phone used to wait for one round trip after another. A session that already
 * proves a verified email and an enrolled authenticator needs none of them, and the profile read
 * starts before the auth checks instead of after.
 */
const calls = vi.hoisted(() => ({ reloads: 0, profileReads: 0, order: [] as string[] }));

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof FirebaseAuth>()),
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    queueMicrotask(() => callback({
      uid: 'staff-1',
      email: 'staff@example.com',
      displayName: 'Staff',
      emailVerified: true,
      getIdTokenResult: async () => { calls.order.push('token'); return { claims: { firebase: { sign_in_second_factor: 'totp' } } }; },
    }));
    return () => undefined;
  },
  reload: async () => { calls.reloads += 1; },
  multiFactor: () => ({ enrolledFactors: [{ factorId: 'totp' }] }),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof Firestore>()),
  doc: () => ({}),
  collection: () => ({}),
  getDoc: async () => {
    calls.profileReads += 1;
    calls.order.push('profile');
    return { exists: () => true, data: () => ({ active: true, roles: { 'property-main': 'front_desk' }, allowedPages: { 'property-main': ['rooms'] } }) };
  },
  onSnapshot: () => () => undefined,
}));

import { AuthGate } from '../src/auth/AuthGate.js';
import type { FirebaseClient } from '../src/firebase-client.js';
import { LocaleProvider } from '../src/i18n/locale.js';

afterEach(cleanup);

describe('a complete session on a slow phone connection', () => {
  it('skips the account refresh and starts the profile read first', async () => {
    const client = { auth: {}, db: {}, functions: {}, propertyId: 'property-main' } as unknown as FirebaseClient;
    render(<LocaleProvider initialLocale="zh-TW"><AuthGate client={client} /></LocaleProvider>);

    expect(await screen.findByRole('heading', { name: '今日營運' })).toBeInTheDocument();
    expect(calls.reloads).toBe(0);
    expect(calls.profileReads).toBe(1);
    expect(calls.order[0]).toBe('profile');
  });
});
