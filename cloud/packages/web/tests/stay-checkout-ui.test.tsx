// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveStayItem, PaymentListItem } from '@bini/cloud-shared';

import type { StaffSession } from '../src/auth/session.js';
import { StayCheckoutPage } from '../src/stays/StayCheckoutPage.js';

const session: StaffSession = { uid: 'front-1', email: 'front@example.com', displayName: 'Front', propertyId: 'property-main', role: 'front_desk', allowedPages: ['checkout'] };
// 24h stay Mon 13:00 → Tue 13:00 (Taipei), NT$1,000 due.
const stay: ActiveStayItem = { stayId: 'STY-202', roomId: '202', guestName: 'Late Guest', phone: null, plan: '24hrs', checkInAt: '2026-09-14T13:00:00+08:00', checkOutAt: '2026-09-15T13:00:00+08:00', originalCheckOutAt: '2026-09-15T13:00:00+08:00', baseRentNts: 1_000, extensionFeeNts: 0, extraFeeNts: 0, totalDueNts: 1_000, bookingId: null, createdAt: '2026-09-14T13:00:00+08:00' };
const payment = (amountNts: number, deposit = false): PaymentListItem => ({ paymentId: `P-${amountNts}`, roomId: '202', guestName: 'Late Guest', paymentType: 'cash', amountNts, deposit, refund: false, status: 'paid', note: null, createdAt: '2026-09-14T13:05:00+08:00' });
const staysGateway = { subscribe: (_p: string, onValue: (value: ActiveStayItem[]) => void) => { onValue([stay]); return () => undefined; } };
const paymentsOf = (items: PaymentListItem[]) => ({ subscribe: (_p: string, onValue: (value: PaymentListItem[]) => void) => { onValue(items); return () => undefined; } });
const result = { status: 'checked_out', stayId: 'STY-202', roomId: '202', checkedOutAt: '2026-09-15T06:00:00.000Z', totalChargedNts: 1_000, extensionFeeNts: 0, systemOverdueFeeNts: 400, appliedOverdueFeeNts: 0, freeCancel: false, refundedDepositNts: 0 } as const;

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('v3 check-out flow', () => {
  it('shows received and balance, confirms overdue with a staff correction, then reminds to collect the balance', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T14:20:00+08:00'));
    const checkout = vi.fn().mockResolvedValue(result);
    render(<StayCheckoutPage gateway={{ checkout }} onBack={vi.fn()} paymentListGateway={paymentsOf([payment(600, true)])} session={session} staysGateway={staysGateway} />);
    fireEvent.change(screen.getByLabelText('選擇在住房'), { target: { value: 'STY-202' } });
    expect(screen.getByText('已收款').nextSibling).toHaveTextContent('NT$ 600');
    expect(screen.getByText('↳ 含押金').nextSibling).toHaveTextContent('NT$ 600');
    // The summary already estimates the overdue fee live: 1h20m past check-out → 2 billable hours → NT$ 400.
    expect(screen.getByText('逾時費（已過退房 1 小時 20 分，計 2 小時）').nextSibling).toHaveTextContent('NT$ 400');
    expect(screen.getByText('應付總金額').nextSibling).toHaveTextContent('NT$ 1,400');
    expect(screen.getByText('餘額應收').nextSibling).toHaveTextContent('NT$ 800');

    fireEvent.click(screen.getByRole('button', { name: '確認辦理退房' }));
    // 14:20 is 65 minutes past the 13:15 grace end; 25h20m rounds up to 26h, i.e. two billable hours.
    expect(await screen.findByText('已超過退房時間，將產生 NT$ 400 的延住費用，確認嗎？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '修正' }));
    fireEvent.click(screen.getByRole('button', { name: '減少 1 小時' }));
    expect(screen.getByLabelText('超時時間（小時）')).toHaveValue(1);
    fireEvent.click(screen.getByRole('button', { name: '減少 1 小時' }));
    expect(screen.getByText('NT$ 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '套用修正，確認退房' }));

    expect(await screen.findByText('請收取餘額')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已收款，確認退房' }));
    await waitFor(() => expect(checkout).toHaveBeenCalledWith({ propertyId: 'property-main', operationId: expect.any(String), stayId: 'STY-202', extraFeeNts: 0, overdueFeeOverrideNts: 0 }));
    expect(await screen.findByText('退房已完成')).toBeInTheDocument();
  });

  it('waives the overdue fee when staff forgot to check out a guest who already left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-22T07:42:00+08:00'));
    const checkout = vi.fn().mockResolvedValue(result);
    render(<StayCheckoutPage gateway={{ checkout }} onBack={vi.fn()} paymentListGateway={paymentsOf([payment(1_000)])} session={session} staysGateway={staysGateway} />);
    fireEvent.change(screen.getByLabelText('選擇在住房'), { target: { value: 'STY-202' } });
    expect(screen.getByText(/^逾時費（已過退房 6 天 18 小時 42 分/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認辦理退房' }));
    fireEvent.click(await screen.findByRole('button', { name: '修正' }));
    fireEvent.click(screen.getByRole('button', { name: '免收逾時費，確認退房' }));
    await waitFor(() => expect(checkout).toHaveBeenCalledWith(expect.objectContaining({ stayId: 'STY-202', overdueFeeOverrideNts: 0 })));
    expect(screen.queryByText('請收取餘額')).not.toBeInTheDocument();
  });

  it('checks out directly when on time and settled, leaving the fee to the server', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T13:10:00+08:00'));
    const checkout = vi.fn().mockResolvedValue({ ...result, systemOverdueFeeNts: 0 });
    render(<StayCheckoutPage gateway={{ checkout }} onBack={vi.fn()} paymentListGateway={paymentsOf([payment(1_000)])} session={session} staysGateway={staysGateway} />);
    fireEvent.change(screen.getByLabelText('選擇在住房'), { target: { value: 'STY-202' } });
    expect(screen.getByText(/已結清/)).toBeInTheDocument();
    expect(screen.queryByText(/^逾時費/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認辦理退房' }));
    await waitFor(() => expect(checkout).toHaveBeenCalledWith(expect.objectContaining({ overdueFeeOverrideNts: null })));
    expect(screen.queryByText('請收取餘額')).not.toBeInTheDocument();
  });

  it('never asks for money inside the 15-minute free-cancel window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-14T13:08:00+08:00'));
    const checkout = vi.fn().mockResolvedValue({ ...result, freeCancel: true, totalChargedNts: 0, refundedDepositNts: 300 });
    render(<StayCheckoutPage gateway={{ checkout }} onBack={vi.fn()} paymentListGateway={paymentsOf([payment(300, true)])} session={session} staysGateway={staysGateway} />);
    fireEvent.change(screen.getByLabelText('選擇在住房'), { target: { value: 'STY-202' } });
    expect(screen.getByText(/15 分鐘免費取消 · 已入住 8 分鐘/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認辦理退房' }));
    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/押金 NT\$ 300 已自動退還/)).toBeInTheDocument();
  });
});
