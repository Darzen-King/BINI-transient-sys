// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditListProjection } from '@bini/cloud-shared';

import { App } from '../src/App.js';
import type { AuditGateway } from '../src/audit/audit-gateway.js';
import type { StaffSession } from '../src/auth/session.js';

afterEach(cleanup);

const session: StaffSession = { uid: 'admin-1', email: 'admin@example.com', displayName: 'Admin', propertyId: 'property-main', role: 'admin', allowedPages: ['audit'] };

const projection: AuditListProjection = {
  items: [{
    auditId: 'A1',
    createdAt: '2026-10-03T18:13:00.000Z',
    action: 'stay.checkin',
    targetId: 'STY-F13058A866D6',
    targetType: 'stay',
    actor: 'es430alO4yZmpD15ngM4HTp6lVB2',
    description: null,
    before: null,
    after: null,
    // Stored exactly as the server writes it: UTC timestamps and plain numbers.
    details: { roomId: '203', bookingId: 'RSV-261003-4292A839', checkInAt: '2026-10-03T18:13:00.000Z', bookedCheckInAt: '2026-10-03T10:00:00.000Z', amountNts: 1200, paymentId: null },
  }],
  total: 1,
  page: 1,
  totalPages: 1,
  actions: ['stay.checkin'],
};

const gateway: AuditGateway = { subscribe(_propertyId, _query, onValue) { queueMicrotask(() => onValue(projection)); return () => undefined; } };

describe('audit record details', () => {
  it('reads as fields in Taipei time, not raw stored values', async () => {
    render(<App auditGateway={gateway} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '審計軌跡' }));
    fireEvent.click(await screen.findByRole('button', { name: /STY-F13058A866D6/ }));

    const dialog = screen.getByRole('dialog');
    // 18:13 UTC is 02:13 the next day in Taipei — the same instant the header already shows.
    expect(within(dialog).getByText('入住時間').nextSibling).toHaveTextContent('2026/10/04 02:13');
    expect(within(dialog).getByText('預約入住時間').nextSibling).toHaveTextContent('2026/10/03 18:00');
    expect(within(dialog).getByText('房間').nextSibling).toHaveTextContent('203');
    expect(within(dialog).getByText('金額').nextSibling).toHaveTextContent('NT$ 1,200');
    expect(within(dialog).getByText('付款編號').nextSibling).toHaveTextContent('—');
    expect(within(dialog).queryByText(/2026-10-03T18:13:00.000Z/)).not.toBeInTheDocument();
  });
});
