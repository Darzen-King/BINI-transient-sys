import { createHash } from 'node:crypto';

import {
  buildActiveStayItems,
  buildBookingSoonList,
  buildCheckoutSoonList,
  type ActiveStayItem,
  type BookingSoonItem,
  type CheckoutSoonItem,
} from '@bini/cloud-shared';

import { roleForProperty } from '../admin/staff-access.js';

export interface SourceDocument { id: string; data: unknown }

/** Token documents are keyed by a hash so the raw token never appears in a document path or log line. */
export function pushTokenDocId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Every active staff account holding any role on the property receives its reminders (store decision). */
export function propertyRecipientUids(users: readonly SourceDocument[], propertyId: string): string[] {
  return users.filter((user) => roleForProperty(user.data, propertyId) !== null).map((user) => user.id);
}

/** A malformed document must not silence reminders for every other booking or stay, so each is parsed on its own. */
export function reminderSources(bookings: readonly SourceDocument[], stays: readonly SourceDocument[], nowMillis: number): { bookings: BookingSoonItem[]; checkouts: CheckoutSoonItem[]; skipped: string[] } {
  const skipped: string[] = [];
  const soonBookings = bookings.flatMap((document) => {
    try { return buildBookingSoonList([document], nowMillis); } catch { skipped.push(`bookings/${document.id}`); return []; }
  });
  const activeStays = stays.flatMap((document): ActiveStayItem[] => {
    try { return buildActiveStayItems([document]); } catch { skipped.push(`stays/${document.id}`); return []; }
  });
  return { bookings: soonBookings, checkouts: buildCheckoutSoonList(activeStays, nowMillis), skipped };
}

const STALE_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

/** Indexes of tokens FCM reports as gone (uninstalled, permission revoked); those token documents are deleted. */
export function staleTokenIndexes(responses: readonly { success: boolean; error?: { code?: string } | undefined }[]): number[] {
  return responses.flatMap((response, index) => (!response.success && STALE_TOKEN_CODES.has(response.error?.code ?? '') ? [index] : []));
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}
