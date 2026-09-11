import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MIGRATION_PROPERTY_ID,
  V3_AUTHORITATIVE_ENTITY_MAPPINGS,
  V3_DERIVED_OR_EXCLUDED_DATA,
  V3_IDENTITY_MAPPING,
  V3MigrationMetadataSchema,
  legacyBoolean,
  legacyNtsAmount,
  legacyTaipeiDateTimeToIso,
  normalizeMigrationPropertyId,
  v3DocumentId,
} from '@bini/cloud-shared';

const mappingFor = (sourceTable: string) => {
  const mapping = V3_AUTHORITATIVE_ENTITY_MAPPINGS.find((candidate) => candidate.sourceTable === sourceTable);
  if (!mapping) throw new Error(`missing mapping for ${sourceTable}`);
  return mapping;
};

describe('v3.9.14 to Firestore migration mapping', () => {
  it('covers every authoritative non-identity v3 table exactly once', () => {
    expect(V3_AUTHORITATIVE_ENTITY_MAPPINGS.map((mapping) => mapping.sourceTable)).toEqual([
      'properties',
      'rooms',
      'bookings',
      'active_stays',
      'stay_logs',
      'activity_logs',
      'payments',
      'cashier_sessions',
      'cost_entries',
      'maintenance_schedules',
      'monthly_rentals',
      'holiday_cache',
    ]);
  });

  it('maps blank property ids to the confirmed DEV property', () => {
    expect(normalizeMigrationPropertyId(null)).toBe(DEFAULT_MIGRATION_PROPERTY_ID);
    expect(normalizeMigrationPropertyId('  ')).toBe(DEFAULT_MIGRATION_PROPERTY_ID);
    expect(normalizeMigrationPropertyId(' P001 ')).toBe('P001');
    expect(() => normalizeMigrationPropertyId('', 'bad/id')).toThrow();
  });

  it('creates deterministic document ids without collection path injection', () => {
    expect(v3DocumentId(mappingFor('rooms'), '201')).toBe('201');
    expect(v3DocumentId(mappingFor('bookings'), 'RSV-260825-1FFD')).toBe('RSV-260825-1FFD');
    expect(v3DocumentId(mappingFor('payments'), 96)).toBe('v3-payments-96');
    expect(v3DocumentId(mappingFor('holiday_cache'), '2026-10-10')).toBe('2026-10-10');
    expect(() => v3DocumentId(mappingFor('rooms'), 'property/room')).toThrow();
    expect(() => v3DocumentId(mappingFor('payments'), '-1')).toThrow();
  });

  it('converts local v3 date strings to explicit Asia/Taipei offsets', () => {
    expect(legacyTaipeiDateTimeToIso('2026-09-10 18:35:28')).toBe('2026-09-10T18:35:28+08:00');
    expect(legacyTaipeiDateTimeToIso('2026-09-10 18:35')).toBe('2026-09-10T18:35:00+08:00');
    expect(legacyTaipeiDateTimeToIso('2026-09-10')).toBe('2026-09-10T00:00:00+08:00');
    expect(legacyTaipeiDateTimeToIso(null)).toBeNull();
    expect(() => legacyTaipeiDateTimeToIso('2026-02-30 10:00')).toThrow();
  });

  it('normalizes SQLite booleans and integer NTS amounts strictly', () => {
    expect(legacyBoolean(1)).toBe(true);
    expect(legacyBoolean('0')).toBe(false);
    expect(() => legacyBoolean('yes')).toThrow();
    expect(legacyNtsAmount('1200')).toBe(1200);
    expect(legacyNtsAmount(-300)).toBe(-300);
    expect(() => legacyNtsAmount(12.5)).toThrow();
  });

  it('records idempotent source metadata with a SHA-256 checksum', () => {
    const metadata = {
      schemaVersion: 1,
      sourceVersion: '3.9.14',
      sourceTable: 'bookings',
      sourceId: 'RSV-260825-1FFD',
      sourceChecksumSha256: 'a'.repeat(64),
      importedAt: '2026-09-10T12:00:00.000Z',
    };
    expect(V3MigrationMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(() => V3MigrationMetadataSchema.parse({ ...metadata, sourceChecksumSha256: 'short' })).toThrow();
  });

  it('never treats local credentials, cached next booking or summaries as authoritative', () => {
    expect(V3_IDENTITY_MAPPING.forbiddenFields).toEqual(['password_hash', 'password_salt']);
    expect(V3_DERIVED_OR_EXCLUDED_DATA.map((item) => item.source)).toEqual(expect.arrayContaining([
      'rooms.next_booking',
      'report_summary',
      'backup_state',
      'backup_logs',
      'backup_config',
      'users.password_hash',
      'users.password_salt',
    ]));
  });
});
