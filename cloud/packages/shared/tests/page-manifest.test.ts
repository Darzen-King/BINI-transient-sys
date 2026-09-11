import { describe, expect, it } from 'vitest';

import {
  CLOUD_PAGE_IDS,
  CLOUD_PAGE_MANIFEST,
  pagesAllowedForNavigation,
  pagesForMobileTab,
} from '@bini/cloud-shared';

describe('full PMS navigation manifest', () => {
  it('matches every cloud page permission exactly once and preserves v3 order', () => {
    expect(CLOUD_PAGE_MANIFEST.map((page) => page.id)).toEqual(CLOUD_PAGE_IDS);
    expect(new Set(CLOUD_PAGE_MANIFEST.map((page) => page.desktopPath)).size).toBe(CLOUD_PAGE_MANIFEST.length);
    expect(CLOUD_PAGE_MANIFEST.map((page) => page.desktopOrder)).toEqual(
      [...CLOUD_PAGE_MANIFEST].map((page) => page.desktopOrder).sort((a, b) => a - b),
    );
  });

  it('does not expose the removed external-backup page', () => {
    expect(CLOUD_PAGE_MANIFEST.some((page) => page.desktopPath === '/backup')).toBe(false);
    expect(CLOUD_PAGE_MANIFEST.some((page) => page.id === ('backup' as never))).toBe(false);
  });

  it('filters both desktop and mobile navigation with the same page permissions', () => {
    const allowed = ['rooms', 'bookings', 'payments'] as const;
    expect(pagesAllowedForNavigation(allowed).map((page) => page.id)).toEqual([
      'rooms', 'payments', 'bookings',
    ]);
    expect(pagesForMobileTab(allowed, 'bookings').map((page) => page.id)).toEqual(['bookings']);
    expect(pagesForMobileTab(allowed, 'payments').map((page) => page.id)).toEqual(['payments']);
    expect(pagesForMobileTab(allowed, 'more')).toEqual([]);
  });

  it('keeps every low-frequency module reachable from mobile More or another primary tab', () => {
    for (const page of CLOUD_PAGE_MANIFEST) {
      expect(['today', 'bookings', 'housekeeping', 'payments', 'more']).toContain(page.mobileTab);
    }
    expect(pagesForMobileTab(CLOUD_PAGE_IDS, 'more').map((page) => page.id)).toEqual([
      'gantt', 'reports', 'audit', 'users', 'properties', 'costs', 'holidays',
    ]);
  });
});
