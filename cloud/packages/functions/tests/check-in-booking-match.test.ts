import { describe, expect, it } from 'vitest';

import { sameInstant } from '../src/stays/check-in.js';

describe('check-in source booking match', () => {
  it('accepts an imported v3 booking time (+08:00) against the cloud quote (UTC Z)', () => {
    expect(sameInstant('2026-09-19T11:00:00+08:00', '2026-09-19T03:00:00.000Z')).toBe(true);
    expect(sameInstant('2026-09-15T05:00:00.000Z', '2026-09-15T05:00:00.000Z')).toBe(true);
  });

  it('still rejects a booking whose time really changed or is unreadable', () => {
    expect(sameInstant('2026-09-19T11:00:00+08:00', '2026-09-19T03:01:00.000Z')).toBe(false);
    expect(sameInstant('not-a-date', 'not-a-date')).toBe(false);
  });
});
