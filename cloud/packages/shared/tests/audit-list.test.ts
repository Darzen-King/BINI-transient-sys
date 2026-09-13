import { describe, expect, it } from 'vitest';
import { buildAuditList } from '@bini/cloud-shared';

const rows = [
  { id: 'legacy', data: { createdAt: '2026-09-11T01:00:00.000Z', action: 'checkin', targetId: '201', targetType: 'room', actorLegacyId: 'admin', description: 'Check-in: Carlos', originalValue: { status: '可入住' }, newValue: { status: '使用中' } } },
  { id: 'modern', data: { createdAt: '2026-09-12T01:00:00.000Z', action: 'booking.create', targetId: 'RSV-1', targetType: 'booking', actorUid: 'uid-1', details: { roomId: '202', guestName: 'Juvy' } } },
] as const;

describe('audit list projection', () => {
  it('keeps migrated and current audit shapes searchable and newest-first', () => {
    const result = buildAuditList(rows, { action: '', targetId: '', keyword: 'juvy', page: 1 });
    expect(result.total).toBe(1); expect(result.items[0]).toMatchObject({ auditId: 'modern', actor: 'uid-1', targetId: 'RSV-1' });
  });
  it('filters action and targets then keeps v3 before/after details', () => {
    const result = buildAuditList(rows, { action: 'checkin', targetId: '201', keyword: '', page: 1 });
    expect(result.items[0]?.before).toEqual({ status: '可入住' }); expect(result.items[0]?.after).toEqual({ status: '使用中' });
  });
});
