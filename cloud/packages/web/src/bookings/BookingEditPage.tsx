import { useEffect, useRef, useState, type FormEvent } from 'react';
import { type BookingListItem, type BookingPreviewResult, type BookingRoomOption, type BookingUpdateResult } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import { Button, DateTimeInput, Field, MoneyInput, Notice, NumberStepper, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { BookingRoomGateway } from '../rooms/booking-room-options.js';
import type { BookingUpdateGateway } from './booking-update.js';
import type { BookingUpdatePreviewGateway } from './booking-update-preview.js';
import type { HolidayCalendarGateway } from '../stays/holiday-calendar.js';
import { RateReference, RateTypeField, useBookingRateType } from './rate-type.js';
import { AmountField, CheckoutPreviewField, pricingFor, quoteForForm, toTaipeiIso, useHolidayCalendar, useManualAmount } from './auto-pricing.js';

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
  // Client-side schema failures carry a raw JSON issue list; staff need a readable hint instead.
  if (error instanceof Error && error.name === 'ZodError') return text('資料不完整或格式不正確，請檢查房間與各欄位後再試。', 'Some fields are missing or invalid. Check the room and other fields, then try again.');
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return text('無法修改預約，請稍後再試。', 'The booking could not be updated. Try again shortly.');
}

function previewErrorMessage(error: unknown, text: (zhTw: string, en: string) => string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return text('無法取得修改預覽，請稍後再試。', 'The edit preview could not be loaded. Try again shortly.');
}

export function BookingEditPage({
  booking,
  session,
  gateway,
  previewGateway,
  roomGateway,
  holidayGateway,
  latestBooking,
  onReload,
  onBack,
}: {
  booking: BookingListItem;
  /** Live copy of this booking (undefined while unknown, null once it left the active list on another device). */
  latestBooking?: BookingListItem | null | undefined;
  onReload?: ((booking: BookingListItem) => void) | undefined;
  session: StaffSession;
  gateway: BookingUpdateGateway | undefined;
  previewGateway: BookingUpdatePreviewGateway | undefined;
  roomGateway: BookingRoomGateway | undefined;
  holidayGateway?: HolidayCalendarGateway | undefined;
  onBack: () => void;
}) {
  const { text } = useLocale();
  const [rooms, setRooms] = useState<BookingRoomOption[] | null>(null);
  const [roomError, setRoomError] = useState(false);
  // Controlled: the room list arrives after mount, and an uncontrolled defaultValue would be lost, leaving the browser on
  // the first (possibly disabled monthly) option, which FormData then omits.
  const [roomId, setRoomId] = useState(booking.roomId);
  const [checkInLocal, setCheckInLocal] = useState(() => taipeiLocalInputValue(booking.checkInAt));
  const [plan, setPlan] = useState<'12hrs' | '24hrs'>(booking.plan === '12hrs' ? '12hrs' : '24hrs');
  const [days, setDays] = useState(() => bookingDays(booking));
  const [discountNts, setDiscountNts] = useState(booking.discountNts);
  const calendar = useHolidayCalendar(holidayGateway, session.propertyId);
  const quote = quoteForForm(checkInLocal, plan, days, discountNts, calendar);
  // v3 edits re-price automatically; a booking that was manually priced keeps its amount until the stay details change.
  const [manualAmountNts, setManualAmountNts] = useManualAmount(`${checkInLocal}|${plan}|${days}|${discountNts}`, booking.pricingMode === 'manual' ? booking.amountNts : null);
  // Keep the stored label (possibly a v3 manual pick) until staff change the check-in date.
  const rate = useBookingRateType(holidayGateway, session.propertyId, { checkInLocal: taipeiLocalInputValue(booking.checkInAt), manual: booking.rateType === '假日' || booking.rateType === '非假日' ? booking.rateType : null });
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<BookingUpdateResult | null>(null);
  const [preview, setPreview] = useState<BookingPreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

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
    if (!roomId) { setError(text('請選擇房間。', 'Choose a room.')); return; }
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
        roomId,
        guestName: String(data.get('guestName') ?? ''),
        phone: String(data.get('phone') ?? '').trim() || null,
        checkInAt: toTaipeiIso(checkInLocal),
        plan,
        days,
        discountNts,
        ...pricingFor(quote, manualAmountNts),
        ...(rate.manual ? { rateType: rate.manual } : {}),
        expectedVersion: booking.version ?? 0,
      });
      setUpdated(result);
      setPendingOperationId(null);
    } catch (submitError) {
      setError(functionErrorMessage(submitError, text));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!previewGateway || !formRef.current) return;
    setPreviewBusy(true);
    setPreviewError('');
    setPreview(null);
    try {
      setPreview(await previewGateway.preview({
        propertyId: session.propertyId,
        bookingId: booking.bookingId,
        roomId,
        checkInAt: toTaipeiIso(checkInLocal),
        plan,
        days,
        discountNts,
        ...pricingFor(quote, manualAmountNts),
      }));
    } catch (previewFailure) {
      setPreviewError(previewErrorMessage(previewFailure, text));
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <SectionCard hint={text('伺服器重新檢查衝突與價格', 'Server rechecks conflicts and pricing')} title={text(`修改預約 · ${booking.bookingId}`, `Edit booking · ${booking.bookingId}`)}>
      <p className="booking-create-intro">{text('會排除這筆預約自身後，重新檢查房間、有效預約、在住房與未完成維修；既有訂金付款不會在此表單被修改。', 'The server excludes this booking itself, then rechecks the room, active bookings, stays, and unfinished maintenance. Existing deposit payments are not changed here.')}</p>
      {!updated && !busy && latestBooking === null ? <Notice tone="danger" title={text('此預約已被其他裝置取消或辦理入住', 'This booking was cancelled or checked in on another device')}>{text('無法再修改，請返回預約管理確認。', 'It can no longer be edited. Go back to bookings to check.')}</Notice> : null}
      {!updated && !busy && latestBooking && (latestBooking.version ?? 0) !== (booking.version ?? 0) ? <Notice tone="warning" title={text('此預約已被其他裝置修改', 'This booking was changed on another device')}>{text('畫面上的資料已過期，儲存會被拒絕以免蓋掉對方的修改。請載入最新資料後再修改。', 'This form is out of date; saving is refused so the other change is not overwritten. Load the latest data, then edit again.')}{onReload ? <div><Button onClick={() => onReload(latestBooking)} size="sm" variant="outline">{text('載入最新資料', 'Load latest data')}</Button></div> : null}</Notice> : null}
      {!gateway ? <Notice tone="warning" title={text('預覽模式', 'Preview mode')}>{text('此介面尚未接上 Firebase 寫入服務。', 'This preview is not connected to Firebase writes.')}</Notice> : null}
      {roomError ? <Notice tone="danger" title={text('無法載入房間', 'Unable to load rooms')}>{text('房間清單載入失敗時不提供送出。', 'Submission is unavailable when the room list fails to load.')}</Notice> : null}
      {roomGateway && rooms === null && !roomError ? <p className="booking-create-loading">{text('正在載入可選房間…', 'Loading room choices…')}</p> : null}
      {updated ? <Notice tone="success" title={text('預約已更新', 'Booking updated')}>
        <p>{text(`入住 ${updated.checkInAt}，退房 ${updated.checkOutAt}，金額 NT$ ${updated.amountNts.toLocaleString()}`, `Check-in ${updated.checkInAt}, check-out ${updated.checkOutAt}, total NT$ ${updated.amountNts.toLocaleString()}`)}</p>
        <Button onClick={onBack} variant="outline">{text('返回預約管理', 'Back to bookings')}</Button>
      </Notice> : null}
      <form className="booking-create-form" ref={formRef} onSubmit={(event) => void submit(event)}>
        <div className="booking-create-grid">
          <Field label={text('房間', 'Room')}><select disabled={!gateway || rooms === null || roomError} name="roomId" onChange={(event) => setRoomId(event.target.value)} required value={roomId}>{rooms && !rooms.some((room) => room.roomId === roomId) ? <option value={roomId}>{roomId}</option> : null}{(rooms ?? []).map((room) => <option disabled={room.status === '月租套房' && room.roomId !== booking.roomId} key={room.roomId} value={room.roomId}>{room.roomId} · {roomStatusLabel(room.status, text)}</option>)}</select></Field>
          <Field label={text('住客姓名', 'Guest name')}><input defaultValue={booking.guestName} disabled={!gateway} maxLength={300} name="guestName" required /></Field>
          <Field label={text('電話', 'Phone')}><input defaultValue={booking.phone ?? ''} disabled={!gateway} maxLength={100} name="phone" inputMode="tel" /></Field>
          <Field label={text('入住時間', 'Check-in')}><DateTimeInput disabled={!gateway} name="checkInAt" onChange={(event) => { setCheckInLocal(event.target.value); rate.onCheckInChange(event.target.value); }} required value={checkInLocal} /></Field>
          <CheckoutPreviewField quote={quote} />
          <Field label={text('方案', 'Plan')}><select disabled={!gateway} name="plan" onChange={(event) => setPlan(event.target.value === '12hrs' ? '12hrs' : '24hrs')} value={plan}><option value="12hrs">12hrs</option><option value="24hrs">24hrs</option></select></Field>
          <Field label={text('天數', 'Days')}><NumberStepper decrementLabel={text('減少 1 天', 'One day less')} disabled={!gateway} incrementLabel={text('增加 1 天', 'One day more')} max={366} min={1} onChange={setDays} value={days} name="days" /></Field>
          <Field label={text('折扣（NT$）', 'Discount (NT$)')}><MoneyInput disabled={!gateway} name="discountNts" onChange={setDiscountNts} required value={discountNts} /></Field>
          <AmountField disabled={!gateway} manualAmountNts={manualAmountNts} onChange={setManualAmountNts} quote={quote} />
          <RateTypeField disabled={!gateway} rate={rate} />
        </div>
        <RateReference />
        <div className="booking-preview-actions"><Button disabled={!previewGateway || !gateway || rooms === null || roomError} loading={previewBusy} onClick={() => void runPreview()} type="button" variant="outline">{text('檢查可用性與報價', 'Check availability & quote')}</Button><small>{text('此預覽會排除目前這筆預約；儲存時伺服器仍會重新驗證。', 'This preview excludes this booking; the server validates again on save.')}</small></div>
        {previewError ? <Notice tone="danger" title={text('無法取得預覽', 'Preview unavailable')}>{previewError}</Notice> : null}
        {preview ? <Notice tone={preview.available ? 'success' : 'warning'} title={preview.available ? text('此時段可修改', 'This slot can be updated') : text('此時段不可修改', 'This slot cannot be updated')}>
          <p>{text(`入住 ${preview.quote.checkInAt}，退房 ${preview.quote.checkOutAt}，${preview.quote.rateType}，原價 NT$ ${preview.quote.grossAmountNts.toLocaleString()}，折扣 NT$ ${preview.quote.discountNts.toLocaleString()}，應收 NT$ ${preview.quote.amountNts.toLocaleString()}`, `Check-in ${preview.quote.checkInAt}, check-out ${preview.quote.checkOutAt}, ${preview.quote.rateType}, gross NT$ ${preview.quote.grossAmountNts.toLocaleString()}, discount NT$ ${preview.quote.discountNts.toLocaleString()}, total NT$ ${preview.quote.amountNts.toLocaleString()}`)}</p>
          {!preview.available ? <p>{preview.reason === 'room_unavailable' ? text('找不到房間或此房為月租套房，不能修改為短期預約。', 'The room is unavailable or monthly-only.') : text(`與 ${preview.conflict?.id ?? ''} 的既有時段衝突。`, `Conflicts with ${preview.conflict?.id ?? ''}.`)}</p> : null}
        </Notice> : null}
        {error ? <Notice tone="danger" title={text('無法修改預約', 'Booking could not be updated')}>{error}</Notice> : null}
        <div className="booking-create-actions"><Button disabled={!gateway || rooms === null || roomError || (!updated && latestBooking === null)} loading={busy} size="lg" type="submit">{text('儲存變更', 'Save changes')}</Button><Button onClick={onBack} type="button" variant="outline">{text('返回預約管理', 'Back to bookings')}</Button></div>
      </form>
    </SectionCard>
  );
}
