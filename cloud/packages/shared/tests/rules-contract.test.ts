import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { OPERATION_REQUEST_CLIENT_FIELDS, OPERATION_RESULT_SERVER_FIELDS } from '@bini/cloud-shared';

const rulesPath = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));
const rules = readFileSync(rulesPath, 'utf8');

const normalise = (text: string): string => text.split(/\s+/u).join(' ');

/**
 * firestore.rules cannot import TypeScript, so the field whitelist is duplicated there.
 * These tests keep the duplicate honest: if the contract gains a field and the rules do
 * not, this fails long before the mismatch can reach a deployed project.
 */
describe('firestore.rules stays in sync with the shared contract', () => {
  /** Reads `<marker> = [ 'a', 'b' ]` out of the rules source without a hand-escaped regex. */
  const extractList = (marker: string): string[] => {
    const markerAt = rules.indexOf(marker);
    expect(markerAt, 'firestore.rules must declare ' + marker).toBeGreaterThanOrEqual(0);
    const open = rules.indexOf('[', markerAt);
    const close = rules.indexOf(']', open);
    expect(open, marker + ' must be assigned a list').toBeGreaterThan(markerAt);
    expect(close).toBeGreaterThan(open);
    return rules
      .slice(open + 1, close)
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]/u, '').replace(/['"]$/u, ''))
      .filter((entry) => entry.length > 0);
  };

  it('declares the same client-writable field whitelist', () => {
    expect(extractList('CLIENT_FIELDS').sort()).toEqual([...OPERATION_REQUEST_CLIENT_FIELDS].sort());
  });

  it('declares the same server-only field denylist', () => {
    expect(extractList('SERVER_FIELDS').sort()).toEqual([...OPERATION_RESULT_SERVER_FIELDS].sort());
  });

  it('closes with a default-deny rule', () => {
    expect(normalise(rules)).toContain('match /{document=**} { allow read, write: if false; }');
  });

  it('never grants a blanket write to authenticated users', () => {
    expect(normalise(rules)).not.toContain('allow write: if request.auth != null;');
    expect(normalise(rules)).not.toContain('allow read, write: if request.auth != null;');
  });

  it('keeps authoritative cost records server-written', () => {
    expect(normalise(rules)).toContain('match /costEntries/{docId} { allow read: if hasProperty(propertyId); allow write: if false; }');
  });
});
