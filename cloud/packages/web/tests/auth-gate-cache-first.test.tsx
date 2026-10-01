// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as FirebaseAuth from 'firebase/auth';
import type * as Firestore from 'firebase/firestore';

/**
 * Opening the app on a phone waited for one document to come back from the server, which is most of
 * the "checking your session" wait on a mobile connection. The copy on the device opens it straight
 * away; the server read still decides, so a revoked account is blocked as soon as the network answers.
 */
const profiles = vi.hoisted(() => ({
  cached: { active: true, roles: { 'property-main': 'front_desk' }, allowedPages: { 'property-main': ['rooms'] } } as Record<string, unknown>,
  server: { active: true, roles: { 'property-main': 'front_desk' }, allowedPages: { 'property-main': ['rooms'] } } as Record<string, unknown>,
  releaseServer: () => undefined as void,
}));

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof FirebaseAuth>()),
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    queueMicrotask(() => callback({
      uid: 'staff-1', email: 'staff@example.com', displayName: 'Staff', emailVerified: true,
      getIdTokenResult: async () => ({ claims: { firebase: { sign_in_second_factor: 'totp' } } }),
    }));
    return () => undefined;
  },
  reload: async () => undefined,
  multiFactor: () => ({ enrolledFactors: [{ factorId: 'totp' }] }),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof Firestore>()),
  doc: () => ({}),
  collection: () => ({}),
  getDocFromCache: async () => ({ exists: () => true, data: () => profiles.cached }),
  // The server answer arrives only when the test lets it, standing in for a slow phone connection.
  getDoc: () => new Promise((resolve) => { profiles.releaseServer = () => resolve({ exists: () => true, data: () => profiles.server }); }),
  onSnapshot: () => () => undefined,
}));

import { AuthGate } from '../src/auth/AuthGate.js';
import type { FirebaseClient } from '../src/firebase-client.js';
import { LocaleProvider } from '../src/i18n/locale.js';

afterEach(cleanup);

const client = { auth: {}, db: {}, functions: {}, propertyId: 'property-main' } as unknown as FirebaseClient;

describe('opening the app with a profile already on the device', () => {
  it('opens before the server answers', async () => {
    render(<LocaleProvider initialLocale="zh-TW"><AuthGate client={client} /></LocaleProvider>);

    expect(await screen.findByRole('heading', { name: '今日營運' })).toBeInTheDocument();
    expect(screen.queryByText('正在確認登入狀態…')).not.toBeInTheDocument();
    profiles.releaseServer();
    await waitFor(() => expect(screen.getByRole('heading', { name: '今日營運' })).toBeInTheDocument());
  });

  it('still blocks an account the server reports as inactive', async () => {
    profiles.server = { active: false, roles: { 'property-main': 'front_desk' }, allowedPages: { 'property-main': ['rooms'] } };
    render(<LocaleProvider initialLocale="zh-TW"><AuthGate client={client} /></LocaleProvider>);

    await screen.findByRole('heading', { name: '今日營運' });
    profiles.releaseServer();
    expect(await screen.findByRole('heading', { name: '帳號無法使用' })).toBeInTheDocument();
  });
});
