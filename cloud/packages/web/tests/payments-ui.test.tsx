// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveStayItem, PaymentListItem } from '@bini/cloud-shared';

import { App } from '../src/App.js';
import type { StaffSession } from '../src/auth/session.js';
import type { PaymentCreateGateway } from '../src/payments/payment-create.js';
import type { PaymentListGateway } from '../src/payments/payment-list.js';
import type { ActiveStaysGateway } from '../src/stays/active-stays.js';

const session: StaffSession = { uid: 'front-1', email: 'front@example.com', displayName: 'Front Desk', propertyId: 'property-main', role: 'front_desk', allowedPages: ['payments'] };
const stays: ActiveStayItem[] = [{ stayId: 'STY-live-202', roomId: '202', guestName: 'Live Guest', phone: null, plan: '24hrs', checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z', originalCheckOutAt: '2026-09-15T05:00:00.000Z', baseRentNts: 1_200, extensionFeeNts: 0, extraFeeNts: 0, totalDueNts: 1_200 }];
const payments: PaymentListItem[] = [{ paymentId: 'PAY-old', roomId: '202', guestName: 'Live Guest', paymentType: 'cash', amountNts: 200, deposit: false, refund: false, status: 'paid', note: null, createdAt: '2026-09-12T08:00:00.000Z' }];
const staysGateway: ActiveStaysGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(stays)); return () => undefined; } };
const listGateway: PaymentListGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(payments)); return () => undefined; } };

afterEach(cleanup);

describe('payments UI', () => {
  it('uses the guarded callable for an active-stay payment and retains live history', async () => {
    const create = vi.fn().mockResolvedValue({ status: 'created', paymentId: 'PAY-new', stayId: 'STY-live-202', roomId: '202', amountNts: 1_000, createdAt: '2026-09-12T09:00:00.000Z' });
    render(<App activeStaysGateway={staysGateway} paymentCreateGateway={{ create } satisfies PaymentCreateGateway} paymentListGateway={listGateway} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '付款管理' }));
    fireEvent.change(await screen.findByLabelText('選擇在住房'), { target: { value: 'STY-live-202' } });
    fireEvent.change(screen.getByLabelText('收款金額（NT$）'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('付款方式'), { target: { value: 'transfer' } });
    fireEvent.click(screen.getByRole('button', { name: '確認收款' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ propertyId: 'property-main', operationId: expect.any(String), stayId: 'STY-live-202', amountNts: 1_000, paymentType: 'transfer', note: null }));
    expect(await screen.findByText('收款完成')).toBeInTheDocument();
    expect(screen.getByText('付款紀錄')).toBeInTheDocument();
  });
});
