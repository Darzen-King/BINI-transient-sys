import { describe, expect, it } from 'vitest';

import { hasVerifiedMfaClaims, roleForProperty } from '../src/admin/staff-access.js';

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
});
