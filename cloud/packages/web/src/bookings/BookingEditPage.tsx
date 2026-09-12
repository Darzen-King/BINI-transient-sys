import { useEffect, useState, type FormEvent } from 'react';
import { type BookingListItem, type BookingRoomOption, type BookingUpdateResult } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import { Button, Field, Notice, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { BookingRoomGateway } from '../rooms/booking-room-options.js';
import type { BookingUpdateGateway } from './booking-update.js';

function toTaipeiIso(value: string): string {
  const normalized = value.length === 16 ? `${value}:00` : value;
  return `${normalized}+08:00`;
}

function taipeiLocalInputValue(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function bookingDays(booking: BookingListItem): number {
  const planHours = booking.plan === '12hrs' ? 12 : 24;
  const durationHours = (Date.parse(booking.checkOutAt) - Date.parse(booking.checkInAt)) / (60 * 60 * 1_000);
  return Math.max(1, Math.min(366, Math.round(durationHours / planHours)));
}

function roomStatusLabel(status: BookingRoomOption['status'], text: (zhTw: string, en: string) => string): string {
  const labels: Record<BookingRoomOption['status'], readonly [string, string]> = {
    可入住: ['可入住', 'Vacant'], 使用中: ['使用中', 'Occupied'], 即將退房: ['即將退房', 'Departing'], 待清潔: ['待清潔', 'Needs cleaning'], 清潔中: ['清潔中', 'Cleaning'], 維修中: ['維修中', 'Maintenance'], 月租套房: ['月租套房', 'Monthly rental'],
  };
  return text(...labels[status]);
}

function functionErrorMessage(error: unknown, text: (zhTw: string, en: string) => string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return text('無法修改預約，請稍後再試。', 'The booking could not be updated. Try again shortly.');
}

export function BookingEditPage({
  booking,
  session,
  gateway,
  roomGateway,
  onBack,
}: {
  booking: BookingListItem;
  session: StaffSession;
  gateway: BookingUpdateGateway | undefined;
  roomGateway: BookingRoomGateway | undefined;
  onBack: () => void;
}) {
  const { text } = useLocale();
  const [rooms, setRooms] = useState<BookingRoomOption[] | null>(null);
  const [roomError, setRoomError] = useState(false);
  const [pricingMode, setPricingMode] = useState<'automatic' | 'manual'>(booking.pricingMode ?? 'automatic');
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<BookingUpdateResult | null>(null);

  useEffect(() => {
    if (!roomGateway) return undefined;
    setRooms(null);
    setRoomError(false);
    return roomGateway.subscribe(session.propertyId, (nextRooms) => {
      setRooms(nextRooms);
      setRoomError(false);
    }, () => {
      setRooms(null);
      setRoomError(true);
    });
  }, [roomGateway, session.propertyId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gateway) return;
    const data = new FormData(event.currentTarget);
    const operationId = pendingOperationId ?? crypto.randomUUID();
    if (!pendingOperationId) setPendingOperationId(operationId);
    setBusy(true);
    setError('');
    setUpdated(null);
    try {
      const result = await gateway.update({
        propertyId: session.propertyId,
        operationId,
        bookingId: booking.bookingId,
        roomId: String(data.get('roomId') ?? ''),
        guestName: String(data.get('guestName') ?? ''),
        phone: String(data.get('phone') ?? '').trim() || null,
        checkInAt: toTaipeiIso(String(data.get('checkInAt') ?? '')),
        plan: String(data.get('plan')) === '12hrs' ? '12hrs' : '24hrs',
        days: Number(data.get('days') || 0),
        discountNts: Number(data.get('discountNts') || 0),
        pricingMode,
        ...(pricingMode === 'manual' ? { manualAmountNts: Number(data.get('manualAmountNts') || 0) } : {}),
      });
      setUpdated(result);
      setPendingOperationId(null);
    } catch (submitError) {
      setError(functionErrorMessage(submitError, text));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard hint={text('伺服器重新檢查衝突與價格', 'Server rechecks conflicts and pricing')} title={text(`修改預約 · ${booking.bookingId}`, `Edit booking · ${booking.bookingId}`)}>
      <p className="booking-create-intro">{text('會排除這筆預約自身後，重新檢查房間、有效預約、在住房與未完成維修；既有訂金付款不會在此表單被修改。', 'The server excludes this booking itself, then rechecks the room, active bookings, stays, and unfinished maintenance. Existing deposit payments are not changed here.')}</p>
      {!gateway ? <Notice tone="warning" title={text('預覽模式', 'Preview mode')}>{text('此介面尚未接上 Firebase 寫入服務。', 'This preview is not connected to Firebase writes.')}</Notice> : null}
      {roomError ? <Notice tone="danger" title={text('無法載入房間', 'Unable to load rooms')}>{text('房間清單載入失敗時不提供送出。', 'Submission is unavailable when the room list fails to load.')}</Notice> : null}
      {roomGateway && rooms === null && !roomError ? <p className="booking-create-loading">{text('正在載入可選房間…', 'Loading room choices…')}</p> : null}
      {updated ? <Notice tone="success" title={text('預約已更新', 'Booking updated')}>
        <p>{text(`入住 ${updated.checkInAt}，退房 ${updated.checkOutAt}，金額 NT$ ${updated.amountNts.toLocaleString()}`, `Check-in ${updated.checkInAt}, check-out ${updated.checkOutAt}, total NT$ ${updated.amountNts.toLocaleString()}`)}</p>
        <Button onClick={onBack} variant="outline">{text('返回預約管理', 'Back to bookings')}</Button>
      </Notice> : null}
      <form className="booking-create-form" onSubmit={(event) => void submit(event)}>
        <div className="booking-create-grid">
          <Field label={text('房間', 'Room')}><select defaultValue={booking.roomId} disabled={!gateway || rooms === null || roomError} name="roomId" required>{(rooms ?? []).map((room) => <option disabled={room.status === '月租套房' && room.roomId !== booking.roomId} key={room.roomId} value={room.roomId}>{room.roomId} · {roomStatusLabel(room.status, text)}</option>)}</select></Field>
          <Field label={text('住客姓名', 'Guest name')}><input defaultValue={booking.guestName} disabled={!gateway} maxLength={300} name="guestName" required /></Field>
          <Field label={text('電話', 'Phone')}><input defaultValue={booking.phone ?? ''} disabled={!gateway} maxLength={100} name="phone" inputMode="tel" /></Field>
          <Field label={text('入住時間', 'Check-in')}><input defaultValue={taipeiLocalInputValue(booking.checkInAt)} disabled={!gateway} name="checkInAt" required type="datetime-local" /></Field>
          <Field label={text('方案', 'Plan')}><select defaultValue={booking.plan === '12hrs' ? '12hrs' : '24hrs'} disabled={!gateway} name="plan"><option value="12hrs">12hrs</option><option value="24hrs">24hrs</option></select></Field>
          <Field label={text('天數', 'Days')}><input defaultValue={bookingDays(booking)} disabled={!gateway} max="366" min="1" name="days" required type="number" /></Field>
          <Field label={text('折扣（NT$）', 'Discount (NT$)')}><input defaultValue={booking.discountNts} disabled={!gateway} min="0" name="discountNts" required type="number" /></Field>
          <Field label={text('計價方式', 'Pricing')}><select disabled={!gateway} name="pricingMode" onChange={(event) => setPricingMode(event.target.value === 'manual' ? 'manual' : 'automatic')} value={pricingMode}><option value="automatic">{text('自動計價', 'Automatic')}</option><option value="manual">{text('手動覆寫', 'Manual override')}</option></select></Field>
          {pricingMode === 'manual' ? <Field label={text('手動金額（NT$）', 'Manual amount (NT$)')}><input defaultValue={booking.amountNts} disabled={!gateway} min="0" name="manualAmountNts" required type="number" /></Field> : null}
        </div>
        {error ? <Notice tone="danger" title={text('無法修改預約', 'Booking could not be updated')}>{error}</Notice> : null}
        <div className="booking-create-actions"><Button disabled={!gateway || rooms === null || roomError} loading={busy} size="lg" type="submit">{text('儲存變更', 'Save changes')}</Button><Button onClick={onBack} type="button" variant="outline">{text('返回預約管理', 'Back to bookings')}</Button></div>
      </form>
    </SectionCard>
  );
}
