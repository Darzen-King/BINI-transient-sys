import { z } from 'zod';

export const CLOUD_ROLES = [
  'admin',
  'manager',
  'front_desk',
  'housekeeping',
  'maintenance',
] as const;

export const CLOUD_PAGE_IDS = [
  'rooms',
  'gantt',
  'payments',
  'bookings',
  'bookings_new',
  'checkin',
  'extend',
  'checkout',
  'room_management',
  'housekeeping',
  'maintenance',
  'reports',
  'audit',
  'users',
  'properties',
  'costs',
  'holidays',
] as const;

export type CloudRole = (typeof CLOUD_ROLES)[number];
export type CloudPageId = (typeof CLOUD_PAGE_IDS)[number];

export const ROLE_DEFAULT_PAGES: Record<CloudRole, readonly CloudPageId[]> = {
  admin: CLOUD_PAGE_IDS,
  manager: [
    'rooms', 'gantt', 'payments', 'bookings', 'bookings_new', 'checkin',
    'extend', 'checkout', 'room_management', 'housekeeping', 'maintenance',
    'reports', 'audit', 'holidays',
  ],
  front_desk: [
    'rooms', 'gantt', 'payments', 'bookings', 'bookings_new', 'checkin',
    'extend', 'checkout', 'room_management',
  ],
  housekeeping: ['rooms', 'room_management', 'housekeeping'],
  maintenance: ['rooms', 'room_management', 'maintenance'],
};

const propertyIdSchema = z.string().trim().min(1).max(128);
const uidSchema = z.string().trim().min(1).max(128);
const displayNameSchema = z.string().trim().min(1).max(80);
const roleSchema = z.enum(CLOUD_ROLES);
const allowedPagesSchema = z.array(z.enum(CLOUD_PAGE_IDS)).max(CLOUD_PAGE_IDS.length)
  .refine((pages) => new Set(pages).size === pages.length, 'Duplicate page ids are not allowed.');
const passwordSchema = z.string().min(12).max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter.')
  .regex(/[0-9]/, 'Password must contain a number.');

export const staffListInputSchema = z.object({
  propertyId: propertyIdSchema,
}).strict();

export const staffCreateInputSchema = z.object({
  propertyId: propertyIdSchema,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  displayName: displayNameSchema,
  password: passwordSchema,
  role: roleSchema,
  allowedPages: allowedPagesSchema,
}).strict();

export const staffUpdateInputSchema = z.object({
  propertyId: propertyIdSchema,
  uid: uidSchema,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  displayName: displayNameSchema,
  role: roleSchema,
  active: z.boolean(),
  allowedPages: allowedPagesSchema,
}).strict();

export const staffSetPasswordInputSchema = z.object({
  propertyId: propertyIdSchema,
  uid: uidSchema,
  password: passwordSchema,
}).strict();

/** Admin recovery when a staff member loses their authenticator: clears every second factor so they enrol again. */
export const staffResetMfaInputSchema = z.object({
  propertyId: propertyIdSchema,
  uid: uidSchema,
  reason: z.string().trim().min(1).max(500),
}).strict();

export const staffDirectoryEntrySchema = z.object({
  uid: uidSchema,
  email: z.string().email(),
  displayName: z.string(),
  role: roleSchema,
  active: z.boolean(),
  allowedPages: allowedPagesSchema,
  lastLoginAt: z.string().nullable(),
  mfaEnrolled: z.boolean(),
}).strict();

export type StaffCreateInput = z.infer<typeof staffCreateInputSchema>;
export type StaffUpdateInput = z.infer<typeof staffUpdateInputSchema>;
export type StaffSetPasswordInput = z.infer<typeof staffSetPasswordInputSchema>;
export type StaffResetMfaInput = z.infer<typeof staffResetMfaInputSchema>;

export interface StaffDirectoryEntry {
  uid: string;
  email: string;
  displayName: string;
  role: CloudRole;
  active: boolean;
  allowedPages: CloudPageId[];
  lastLoginAt: string | null;
  mfaEnrolled: boolean;
}
