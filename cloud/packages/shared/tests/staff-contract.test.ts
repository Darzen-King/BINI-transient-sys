import { describe, expect, it } from 'vitest';

import {
  CLOUD_PAGE_IDS,
  ROLE_DEFAULT_PAGES,
  staffCreateInputSchema,
  staffSetPasswordInputSchema,
  staffUpdateInputSchema,
} from '../src/index.js';

const validCreate = {
  propertyId: 'property-main',
  email: 'staff@example.com',
  displayName: 'Front Desk',
  password: 'SafePassword1!',
  role: 'front_desk',
  allowedPages: ['rooms', 'bookings', 'bookings_new'],
};

describe('closed staff-account contract', () => {
  it('accepts an administrator-created internal account', () => {
    expect(staffCreateInputSchema.parse(validCreate)).toEqual(validCreate);
  });

  it('rejects short passwords, unknown roles and unknown pages', () => {
    expect(() => staffCreateInputSchema.parse({ ...validCreate, password: 'short' })).toThrow();
    expect(() => staffCreateInputSchema.parse({ ...validCreate, role: 'owner' })).toThrow();
    expect(() => staffCreateInputSchema.parse({ ...validCreate, allowedPages: ['backup'] })).toThrow();
  });

  it('keeps every cloud role default free of the desktop backup page', () => {
    expect(CLOUD_PAGE_IDS).not.toContain('backup');
    for (const pages of Object.values(ROLE_DEFAULT_PAGES)) expect(pages).not.toContain('backup');
  });

  it('preserves the desktop Gantt feature in the cloud permission model', () => {
    expect(CLOUD_PAGE_IDS).toContain('gantt');
    expect(ROLE_DEFAULT_PAGES.front_desk).toContain('gantt');
  });

  it('protects update and password-reset payloads with strict schemas', () => {
    expect(staffUpdateInputSchema.parse({
      propertyId: 'property-main',
      uid: 'firebase-uid-1',
      displayName: 'Manager',
      role: 'manager',
      active: true,
      allowedPages: ['rooms', 'reports'],
    }).active).toBe(true);

    expect(() => staffUpdateInputSchema.parse({
      propertyId: 'property-main',
      uid: 'firebase-uid-1',
      displayName: 'Manager',
      role: 'manager',
      active: true,
      allowedPages: ['rooms'],
      unexpected: true,
    })).toThrow();

    expect(staffSetPasswordInputSchema.parse({
      propertyId: 'property-main',
      uid: 'firebase-uid-1',
      password: 'AnotherSafe1!',
    }).uid).toBe('firebase-uid-1');
  });
});
