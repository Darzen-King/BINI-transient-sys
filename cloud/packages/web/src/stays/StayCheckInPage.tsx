import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { BookingListItem, BookingRoomOption, StayCheckInResult } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import type { BookingListGateway } from '../bookings/booking-list.js';
import { Button, DateTimeInput, Field, NumberStepper, Notice, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { BookingRoomGateway } from '../rooms/booking-room-options.js';
import type { StayCheckInGateway } from './stay-checkin.js';
import type { HolidayCalendarGateway } from './holiday-calendar.js';
import { AmountField, CheckoutPreviewField, pricingFor, quoteForForm, toTaipeiIso, useHolidayCalendar } from '../bookings/auto-pricing.js';

function taipeiLocalInputValue(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`;
}
function bookingDays(booking: BookingListItem): number { return Math.max(1, Math.round((Date.parse(booking.checkOutAt) - Date.parse(booking.checkInAt)) / ((booking.plan === '12hrs' ? 12 : 24) * 3_600_000))); }
/**
 * The booking a room is holding right now: due within the next hour or already past its arrival but not its check-out.
 * A room-card check-in links it, so a late guest never collides with their own reservation.
 */
export function heldBookingForRoom(bookings: readonly BookingListItem[], roomId: string, nowMillis: number): BookingListItem | null {
  return bookings
    .filter((booking) => booking.roomId === roomId && Date.parse(booking.checkInAt) <= nowMillis + 3_600_000 && Date.parse(booking.checkOutAt) > nowMillis)
    .sort((left, right) => Date.parse(left.checkInAt) - Date.parse(right.checkInAt))[0] ?? null;
}
function errorMessage(error: unknown, text: (zhTw: string, en: string) => string): string { return error instanceof Error && error.message ? error.message : text('入住未完成，請重新確認房間狀態與資料。', 'Check-in did not complete. Confirm the room status and data.'); }

export function StayCheckInPage({ session, gateway, bookingGateway, roomGateway, holidayGateway, initialRoomId, initialBookingId, onInitialRoomHandled, onBack }: {
  session: StaffSession;
  gateway: StayCheckInGateway | undefined;
  bookingGateway: BookingListGateway | undefined;
  roomGateway: BookingRoomGateway | undefined;
  holidayGateway?: HolidayCalendarGateway | undefined;
  /** Vacant room chosen on a room card; preselected once rooms load. */
  initialRoomId?: string | null;
  /** Booking chosen from the booking detail; preselected once bookings load. */
  initialBookingId?: string | null;
  onInitialRoomHandled?: () => void;
  onBack: () => void;
}) {
  const { text } = useLocale();
  const [bookings, setBookings] = useState<BookingListItem[] | null>(null);
  const [rooms, setRooms] = useState<BookingRoomOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [bookingId, setBookingId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [phone, setPhone] = useState('');
  const [checkInAt, setCheckInAt] = useState('');
  const [plan, setPlan] = useState<'12hrs' | '24hrs'>('24hrs');
  const [days, setDays] = useState(1);
  const [discountNts, setDiscountNts] = useState(0);
  // `null` while the amount follows the automatic quote; staff edits or a selected booking's amount make it manual.
  const [manualAmountNts, setManualAmountNts] = useState<number | null>(null);
  const [depositAmountNts, setDepositAmountNts] = useState(0);
  const [depositPaymentType, setDepositPaymentType] = useState<'cash' | 'transfer' | 'card' | 'other'>('cash');
  const [operationId, setOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<StayCheckInResult | null>(null);
  const calendar = useHolidayCalendar(holidayGateway, session.propertyId);
  const quote = quoteForForm(checkInAt, plan, days, discountNts, calendar);
  const selectedBooking = useMemo(() => bookings?.find((item) => item.bookingId === bookingId) ?? null, [bookings, bookingId]);

  useEffect(() => bookingGateway?.subscribe(session.propertyId, (value) => { setBookings(value); setLoadError(false); }, () => { setBookings(null); setLoadError(true); }), [bookingGateway, session.propertyId]);
  useEffect(() => roomGateway?.subscribe(session.propertyId, (value) => { setRooms(value); setLoadError(false); }, () => { setRooms(null); setLoadError(true); }), [roomGateway, session.propertyId]);

  const chooseBooking = (nextId: string) => {
    setBookingId(nextId); setCompleted(null); setError(''); setOperationId(null);
    if (!nextId) setManualAmountNts(null);
    const booking = bookings?.find((item) => item.bookingId === nextId);
    if (!booking) return;
    setRoomId(booking.roomId); setGuestName(booking.guestName); setPhone(booking.phone ?? ''); setCheckInAt(taipeiLocalInputValue(booking.checkInAt)); setPlan(booking.plan === '12hrs' ? '12hrs' : '24hrs'); setDays(bookingDays(booking)); setDiscountNts(booking.discountNts); setManualAmountNts(booking.amountNts);
  };
  // Room card or booking detail: link the booking (even a late arrival's), else preselect the vacant room.
  useEffect(() => {
    if ((!initialRoomId && !initialBookingId) || rooms === null || bookings === null) return;
    const linked = initialBookingId ? bookings.find((item) => item.bookingId === initialBookingId) ?? null : heldBookingForRoom(bookings, initialRoomId ?? '', Date.now());
    if (linked) chooseBooking(linked.bookingId);
    else if (initialRoomId && rooms.some((room) => room.roomId === initialRoomId && room.status === '可入住')) setRoomId(initialRoomId);
    onInitialRoomHandled?.();
  }, [bookings, initialBookingId, initialRoomId, onInitialRoomHandled, rooms]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!gateway || !rooms || loadError) return;
    const nextOperationId = operationId ?? crypto.randomUUID(); if (!operationId) setOperationId(nextOperationId);
    setBusy(true); setError(''); setCompleted(null);
    try {
      const result = await gateway.checkIn({ propertyId: session.propertyId, operationId: nextOperationId, roomId, bookingId: bookingId || null, guestName, phone: phone.trim() || null, checkInAt: toTaipeiIso(checkInAt), plan, days, discountNts, ...pricingFor(quote, manualAmountNts), ...(depositAmountNts > 0 ? { deposit: { amountNts: depositAmountNts, paymentType: depositPaymentType } } : {}) });
      setCompleted(result); setOperationId(null);
    } catch (submitError) { setError(errorMessage(submitError, text)); } finally { setBusy(false); }
  };
  const unavailable = !gateway || !bookingGateway || !roomGateway || rooms === null || bookings === null || loadError;

  return <SectionCard hint={text('伺服器交易驗證', 'Server-authoritative transaction')} title={text('入住登記', 'Check-in')}>
    <p className="booking-create-intro">{text('可由有效預約帶入或建立 walk-in。送出時會同時檢查房態、在住房、預約與維修，並原子建立 stay、更新房態與來源預約。', 'Use an active booking or create a walk-in. The server checks room state, stays, bookings, and maintenance before atomically creating the stay and updating its sources.')}</p>
    {unavailable ? <Notice tone={loadError ? 'danger' : 'warning'} title={text('入住資料尚未就緒', 'Check-in data is not ready')}>{text('讀取失敗或仍在載入時，系統不提供送出，以免入住到錯誤房間。', 'Submission remains unavailable until the live room and booking data is ready.')}</Notice> : null}
    {completed ? <Notice tone="success" title={text('已完成入住', 'Check-in complete')}><p>{text(`房間 ${roomId}，退房 ${completed.checkOutAt}，應收 NT$ ${completed.totalDueNts.toLocaleString()}`, `Room ${roomId}, checkout ${completed.checkOutAt}, due NT$ ${completed.totalDueNts.toLocaleString()}`)}</p><Button onClick={onBack} variant="outline">{text('返回房間總覽', 'Back to room overview')}</Button></Notice> : null}
    <form className="booking-create-form" onSubmit={(event) => void submit(event)}>
      <div className="booking-create-grid">
        <Field label={text('關聯預約（選填）', 'Related booking (optional)')}><select disabled={unavailable} onChange={(event) => chooseBooking(event.target.value)} value={bookingId}><option value="">{text('Walk-in／不帶入預約', 'Walk-in / no booking')}</option>{(bookings ?? []).map((booking) => <option key={booking.bookingId} value={booking.bookingId}>{booking.roomId} · {booking.guestName} · {booking.bookingId}</option>)}</select></Field>
        <Field label={text('房間', 'Room')}><select disabled={unavailable || selectedBooking !== null} onChange={(event) => setRoomId(event.target.value)} required value={roomId}><option value="">{text('選擇可入住的房間', 'Select an available room')}</option>{(rooms ?? []).map((room) => <option disabled={room.status !== '可入住' && room.roomId !== selectedBooking?.roomId} key={room.roomId} value={room.roomId}>{room.roomId} · {room.status}</option>)}</select></Field>
        <Field label={text('住客姓名', 'Guest name')}><input disabled={unavailable || selectedBooking !== null} maxLength={300} onChange={(event) => setGuestName(event.target.value)} required value={guestName} /></Field>
        <Field label={text('電話', 'Phone')}><input disabled={unavailable || selectedBooking !== null} inputMode="tel" maxLength={100} onChange={(event) => setPhone(event.target.value)} value={phone} /></Field>
        <Field label={text('入住時間', 'Check-in')}><DateTimeInput disabled={unavailable || selectedBooking !== null} onChange={(event) => { setCheckInAt(event.target.value); setManualAmountNts(null); }} required value={checkInAt} /></Field>
        <CheckoutPreviewField quote={quote} />
        <Field label={text('方案', 'Plan')}><select disabled={unavailable || selectedBooking !== null} onChange={(event) => { setPlan(event.target.value === '12hrs' ? '12hrs' : '24hrs'); setManualAmountNts(null); }} value={plan}><option value="12hrs">12hrs</option><option value="24hrs">24hrs</option></select></Field>
        <Field label={text('天數', 'Days')}><NumberStepper decrementLabel={text('減少 1 天', 'One day less')} disabled={unavailable || selectedBooking !== null} incrementLabel={text('增加 1 天', 'One day more')} max={366} min={1} onChange={(value) => { setDays(value); setManualAmountNts(null); }} value={days} /></Field>
        <Field label={text('折扣（NT$）', 'Discount (NT$)')}><input disabled={unavailable || selectedBooking !== null} min="0" onChange={(event) => { setDiscountNts(Number(event.target.value) || 0); setManualAmountNts(null); }} required type="number" value={discountNts} /></Field>
        <AmountField disabled={unavailable} label={text('房租金額（NT$）', 'Room charge (NT$)')} manualAmountNts={manualAmountNts} onChange={setManualAmountNts} quote={quote} />
      </div>
      <fieldset className="booking-deposit"><legend>{text('押金收取（選填）', 'Deposit payment (optional)')}</legend><div className="booking-create-grid"><Field label={text('押金（NT$）', 'Deposit (NT$)')}><input disabled={unavailable} min="0" onChange={(event) => setDepositAmountNts(Number(event.target.value) || 0)} type="number" value={depositAmountNts} /></Field><Field label={text('付款方式', 'Payment method')}><select disabled={unavailable} onChange={(event) => setDepositPaymentType(event.target.value as typeof depositPaymentType)} value={depositPaymentType}><option value="cash">{text('現金', 'Cash')}</option><option value="transfer">{text('轉帳', 'Transfer')}</option><option value="card">{text('刷卡', 'Card')}</option><option value="other">{text('其他', 'Other')}</option></select></Field></div></fieldset>
      {error ? <Notice tone="danger" title={text('無法完成入住', 'Check-in could not be completed')}>{error}</Notice> : null}
      <div className="booking-create-actions"><Button disabled={unavailable} loading={busy} size="lg" type="submit">{text('確認辦理入住', 'Confirm check-in')}</Button><Button onClick={onBack} type="button" variant="outline">{text('取消', 'Cancel')}</Button></div>
    </form>
  </SectionCard>;
}
