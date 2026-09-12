import { describe, expect, it } from 'vitest';

import { allowedPagesForProperty, hasPagePermission, hasVerifiedMfaClaims, roleForProperty } from '../src/admin/staff-access.js';

describe('staff callable authorization helpers', () => {
  it('requires both verified email and an actual second-factor sign-in claim', () => {
    expect(hasVerifiedMfaClaims({
      email_verified: true,
      firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' },
    })).toBe(true);
    expect(hasVerifiedMfaClaims({
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    })).toBe(false);
    expect(hasVerifiedMfaClaims({
      email_verified: false,
      firebase: { sign_in_second_factor: 'totp' },
    })).toBe(false);
  });

  it('returns a valid per-property role only for active profiles', () => {
    expect(roleForProperty({ active: true, roles: { 'property-main': 'admin' } }, 'property-main')).toBe('admin');
    expect(roleForProperty({ active: false, roles: { 'property-main': 'admin' } }, 'property-main')).toBeNull();
    expect(roleForProperty({ active: true, roles: { 'property-main': 'owner' } }, 'property-main')).toBeNull();
    expect(roleForProperty({ active: true, roles: { other: 'admin' } }, 'property-main')).toBeNull();
  });

  it('requires both active membership and the configured page allowlist', () => {
    const profile = {
      active: true,
      roles: { 'property-main': 'front_desk' },
      allowedPages: { 'property-main': ['bookings', 'bookings_new', 'not-a-page'] },
    };
    expect(allowedPagesForProperty(profile, 'property-main')).toEqual(['bookings', 'bookings_new']);
    expect(hasPagePermission(profile, 'property-main', 'bookings_new')).toBe(true);
    expect(hasPagePermission(profile, 'property-main', 'payments')).toBe(false);
    expect(hasPagePermission({ ...profile, active: false }, 'property-main', 'bookings_new')).toBe(false);
  });
});
