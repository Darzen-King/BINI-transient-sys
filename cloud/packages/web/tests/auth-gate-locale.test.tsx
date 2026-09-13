// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as FirebaseAuth from 'firebase/auth';
import type * as Firestore from 'firebase/firestore';

const authListeners = vi.hoisted(() => ({ subscribeCount: 0 }));

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof FirebaseAuth>()),
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    authListeners.subscribeCount += 1;
    queueMicrotask(() => callback({ uid: 'admin-1', email: 'admin@example.com', displayName: 'Admin', emailVerified: true, getIdTokenResult: async () => ({ claims: { firebase: { sign_in_second_factor: 'totp' } } }) }));
    return () => undefined;
  },
  multiFactor: () => ({ enrolledFactors: [{ factorId: 'totp' }] }),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof Firestore>()),
  doc: () => ({}),
  collection: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ active: true, roles: { 'property-main': 'admin' }, allowedPages: { 'property-main': ['rooms', 'payments'] } }) }),
  onSnapshot: () => () => undefined,
}));

import { AuthGate } from '../src/auth/AuthGate.js';
import type { FirebaseClient } from '../src/firebase-client.js';
import { LocaleProvider } from '../src/i18n/locale.js';

afterEach(cleanup);

describe('language switch after sign-in', () => {
  it('keeps staff on the current page instead of re-running sign-in and resetting to today', async () => {
    const client = { auth: {}, db: {}, functions: {}, propertyId: 'property-main' } as unknown as FirebaseClient;
    render(<LocaleProvider initialLocale="zh-TW"><AuthGate client={client} /></LocaleProvider>);
    fireEvent.click(await screen.findByRole('link', { name: '付款管理' }));
    expect(await screen.findByRole('heading', { name: '付款管理', level: 2 })).toBeInTheDocument();
    const subscriptionsBefore = authListeners.subscribeCount;

    fireEvent.click(screen.getAllByRole('button', { name: 'EN' })[0]!);

    expect(await screen.findByRole('heading', { name: 'Payments', level: 2 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Payments' })).toHaveClass('active'));
    expect(authListeners.subscribeCount).toBe(subscriptionsBefore);
  });
});
