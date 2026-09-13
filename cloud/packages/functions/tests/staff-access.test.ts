import { describe, expect, it } from 'vitest';

import { allowedPagesForProperty, hasPagePermission, hasVerifiedMfaClaims, mfaResetRefusal, roleForProperty } from '../src/admin/staff-access.js';
import { staffResetMfaInputSchema } from '@bini/cloud-shared';

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

describe('MFA reset guard', () => {
  it('refuses resetting yourself or someone outside the property, and allows a disabled member so they can be recovered', () => {
    expect(mfaResetRefusal('admin-1', 'admin-1', { active: true, roles: { 'property-main': 'admin' } }, 'property-main')).toBe('self');
    expect(mfaResetRefusal('admin-1', 'staff-2', { active: true, roles: { other: 'front_desk' } }, 'property-main')).toBe('not-member');
    expect(mfaResetRefusal('admin-1', 'staff-2', undefined, 'property-main')).toBe('not-member');
    expect(mfaResetRefusal('admin-1', 'staff-2', { active: false, roles: { 'property-main': 'front_desk' } }, 'property-main')).toBeNull();
  });

  it('requires a written reason', () => {
    const base = { propertyId: 'property-main', uid: 'staff-2' };
    expect(staffResetMfaInputSchema.safeParse({ ...base, reason: '  ' }).success).toBe(false);
    expect(staffResetMfaInputSchema.safeParse({ ...base, reason: '手機遺失' }).success).toBe(true);
  });
});
