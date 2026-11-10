import { doc, getDoc, type Firestore } from 'firebase/firestore';

import type { BookingConfirmationProperty } from '@bini/cloud-shared';

export interface PropertyProfileGateway {
  /** Store name, address and phone for printed documents; members may `get` their own property. */
  load(propertyId: string): Promise<BookingConfirmationProperty>;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Store details change perhaps once a year, while the certificate is opened at the counter with a
 * guest waiting, so the read is cached for the whole app rather than repeated on every print. A
 * failed read is never cached, and an edit on this device clears the entry at once.
 */
const CACHE_TTL_MS = 10 * 60 * 1_000;
const cache = new Map<string, { readAt: number; value: Promise<BookingConfirmationProperty> }>();

/** Drops the cached store details, so the next certificate reads them again. */
export function invalidatePropertyProfile(propertyId?: string): void {
  if (propertyId === undefined) cache.clear();
  else cache.delete(propertyId);
}

/**
 * Reads the property document for the details a guest-facing document prints. Properties migrated
 * from v3 keep the same fields under `legacyV3Import`, so both shapes are read.
 */
export function createPropertyProfileGateway(database: Firestore): PropertyProfileGateway {
  return {
    load(propertyId) {
      if (!propertyId || propertyId.includes('/')) return Promise.reject(new Error('invalid property id'));
      const cached = cache.get(propertyId);
      if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) return cached.value;
      const value = getDoc(doc(database, 'properties', propertyId)).then((snapshot) => {
        const data = snapshot.data() ?? {};
        const legacy = (typeof data.legacyV3Import === 'object' && data.legacyV3Import !== null ? data.legacyV3Import : {}) as Record<string, unknown>;
        return {
          name: text(data.name, 200) ?? text(legacy.name, 200) ?? propertyId,
          address: text(data.address, 1_000) ?? text(legacy.address, 1_000),
          phone: text(data.phone, 100) ?? text(legacy.phone, 100),
        } satisfies BookingConfirmationProperty;
      });
      value.catch(() => { if (cache.get(propertyId)?.value === value) cache.delete(propertyId); });
      cache.set(propertyId, { readAt: Date.now(), value });
      return value;
    },
  };
}
