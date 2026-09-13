import { useEffect, useRef, useState, type FormEvent } from 'react';
import { type BookingCreateResult, type BookingMultiCreateResult, type BookingPreviewResult, type BookingRoomOption } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import { Button, Field, Notice, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { BookingCreateGateway } from './booking-create.js';
import type { BookingMultiCreateGateway } from './booking-multi-create.js';
import type { BookingPreviewGateway } from './booking-preview.js';
import type { BookingRoomGateway } from '../rooms/booking-room-options.js';
import type { HolidayCalendarGateway } from '../stays/holiday-calendar.js';
import { RateReference, RateTypeField, useBookingRateType } from './rate-type.js';
import { AmountField, CheckoutPreviewField, pricingFor, quoteForForm, toTaipeiIso, useHolidayCalendar, useManualAmount } from './auto-pricing.js';


function functionErrorMessage(error: unknown, text: (zhTw: string, en: string) => string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return text('無法建立預約，請稍後再試。', 'The booking could not be created. Try again shortly.');
}

function roomStatusLabel(status: BookingRoomOption['status'], text: (zhTw: string, en: string) => string): string {
  const labels: Record<BookingRoomOption['status'], readonly [string, string]> = {
    可入住: ['可入住', 'Vacant'],
    使用中: ['使用中', 'Occupied'],
    即將退房: ['即將退房', 'Departing'],
    待清潔: ['待清潔', 'Needs cleaning'],
    清潔中: ['清潔中', 'Cleaning'],
    維修中: ['維修中', 'Maintenance'],
    月租套房: ['月租套房', 'Monthly rental'],
  };
  return text(...labels[status]);
}

interface MultiSlotDraft {
  key: string;
  roomId: string;
  checkInAt: string;
  plan: '12hrs' | '24hrs';
  days: number;
  discountNts: number;
  /** `null` while the amount follows the automatic quote. */
  manualAmountNts: number | null;
}

function emptyMultiSlot(): MultiSlotDraft {
  return {
    key: crypto.randomUUID(), roomId: '', checkInAt: '', plan: '24hrs', days: 1,
    discountNts: 0, manualAmountNts: null,
  };
}

export function BookingCreatePage({
  session,
  gateway,
  multiGateway,
  previewGateway,
  holidayGateway,
  roomGateway,
  onViewBookings,
}: {
  session: StaffSession;
  gateway: BookingCreateGateway | undefined;
  multiGateway: BookingMultiCreateGateway | undefined;
  previewGateway: BookingPreviewGateway | undefined;
  holidayGateway?: HolidayCalendarGateway | undefined;
  roomGateway: BookingRoomGateway | undefined;
  onViewBookings: () => void;
}) {
  const { text } = useLocale();
  const [rooms, setRooms] = useState<BookingRoomOption[] | null>(null);
  const [roomError, setRoomError] = useState(false);
  const [checkInLocal, setCheckInLocal] = useState('');
  const [plan, setPlan] = useState<'12hrs' | '24hrs'>('24hrs');
  const [days, setDays] = useState(1);
  const [discountNts, setDiscountNts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<BookingCreateResult | null>(null);
  const [multiCreated, setMultiCreated] = useState<BookingMultiCreateResult | null>(null);
  const [multiSlots, setMultiSlots] = useState<MultiSlotDraft[]>([]);
  const [preview, setPreview] = useState<BookingPreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const rate = useBookingRateType(holidayGateway, session.propertyId);
  const calendar = useHolidayCalendar(holidayGateway, session.propertyId);
  const quote = quoteForForm(checkInLocal, plan, days, discountNts, calendar);
  const [manualAmountNts, setManualAmountNts] = useManualAmount(`${checkInLocal}|${plan}|${days}|${discountNts}`);
  const resetPrimary = () => { setCheckInLocal(''); setPlan('24hrs'); setDays(1); setDiscountNts(0); setManualAmountNts(null); };

  // Changing a slot's check-in, plan, days or discount returns its amount to automatic pricing, as in v3.
  const updateMultiSlot = (key: string, patch: Partial<MultiSlotDraft>) => setMultiSlots((current) => current.map((slot) => slot.key === key ? { ...slot, ...patch, ...('checkInAt' in patch || 'plan' in patch || 'days' in patch || 'discountNts' in patch ? { manualAmountNts: null } : {}) } : slot));

  useEffect(() => {
    if (!roomGateway) return undefined;
    setRooms(null);
    setRoomError(false);
    return roomGateway.subscribe(
      session.propertyId,
      (nextRooms) => {
        setRooms(nextRooms);
        setRoomError(false);
      },
      () => {
        setRooms(null);
        setRoomError(true);
      },
    );
  }, [roomGateway, session.propertyId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gateway) return;
    // Capture the form now: React clears `event.currentTarget` once the handler yields at `await`.
    const form = event.currentTarget;
    const data = new FormData(form);
    const depositAmountNts = Number(data.get('depositAmountNts') || 0);
    const operationId = pendingOperationId ?? crypto.randomUUID();
    if (!pendingOperationId) setPendingOperationId(operationId);
    setBusy(true);
    setError('');
    setCreated(null);
    setMultiCreated(null);
    try {
      const primarySlot = {
        roomId: String(data.get('roomId') ?? ''),
        checkInAt: toTaipeiIso(checkInLocal),
        plan,
        days,
        discountNts,
        ...pricingFor(quote, manualAmountNts),
      };
      const deposit = depositAmountNts > 0 ? {
        amountNts: depositAmountNts,
        paymentType: String(data.get('depositPaymentType')) as 'cash' | 'transfer' | 'card' | 'other',
      } : undefined;
      if (multiSlots.length > 0) {
        if (!multiGateway) {
          setError(text('多時段預約服務尚未可用，請重新整理後再試。', 'Multi-slot booking is not available yet. Refresh and try again.'));
          return;
        }
        const result = await multiGateway.create({
          propertyId: session.propertyId,
          operationId,
          guestName: String(data.get('guestName') ?? ''),
          phone: String(data.get('phone') ?? '').trim() || null,
          slots: [primarySlot, ...multiSlots.map((slot) => ({
            roomId: slot.roomId,
            checkInAt: toTaipeiIso(slot.checkInAt),
            plan: slot.plan,
            days: slot.days,
            discountNts: slot.discountNts,
            ...pricingFor(quoteForForm(slot.checkInAt, slot.plan, slot.days, slot.discountNts, calendar), slot.manualAmountNts),
          }))],
          ...(deposit ? { deposit } : {}),
        });
        setMultiCreated(result);
        form.reset();
        resetPrimary();
        setMultiSlots([]);
        setPendingOperationId(null);
        return;
      }
      const result = await gateway.create({
        propertyId: session.propertyId,
        operationId,
        guestName: String(data.get('guestName') ?? ''),
        phone: String(data.get('phone') ?? '').trim() || null,
        ...primarySlot,
        ...(rate.manual ? { rateType: rate.manual } : {}),
        ...(deposit ? { deposit } : {}),
      });
      setCreated(result);
      form.reset();
      rate.reset();
      resetPrimary();
      setPendingOperationId(null);
    } catch (submitError) {
      setError(functionErrorMessage(submitError, text));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!previewGateway || !formRef.current) return;
    const data = new FormData(formRef.current);
    setPreviewBusy(true);
    setPreviewError('');
    setPreview(null);
    try {
      setPreview(await previewGateway.preview({
        propertyId: session.propertyId,
        roomId: String(data.get('roomId') ?? ''),
        checkInAt: toTaipeiIso(checkInLocal),
        plan,
        days,
        discountNts,
        ...pricingFor(quote, manualAmountNts),
      }));
    } catch (previewFailure) {
      setPreviewError(functionErrorMessage(previewFailure, text));
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <SectionCard hint={text('伺服器即時驗證', 'Server-validated')} title={text('新增預約', 'New booking')}>
      <p className="booking-create-intro">{text(
        '送出前會在伺服器同時檢查房間、有效預約、在住房與未完成維修排程；自動計價會依台灣假日規則重算。',
        'Before saving, the server checks the room, active bookings, stays, and unfinished maintenance schedules together. Automatic pricing is recalculated using Taiwan holiday rules.',
      )}</p>
      {!gateway ? <Notice tone="warning" title={text('預覽模式', 'Preview mode')}>{text('此介面尚未接上 Firebase 寫入服務。', 'This preview is not connected to Firebase writes.')}</Notice> : null}
      {roomError ? <Notice tone="danger" title={text('無法載入房間', 'Unable to load rooms')}>{text('為避免建立到錯誤房間，房間清單載入失敗時不提供送出。', 'To avoid booking the wrong room, submission is unavailable when the room list fails to load.')}</Notice> : null}
      {roomGateway && rooms === null && !roomError ? <p className="booking-create-loading">{text('正在載入可選房間…', 'Loading room choices…')}</p> : null}
      {created ? <Notice tone="success" title={text('預約已建立', 'Booking created')}>
        <p>{text(`預約編號：${created.bookingId}`, `Booking ID: ${created.bookingId}`)}</p>
        <p>{text(`入住 ${created.checkInAt}，退房 ${created.checkOutAt}，金額 NT$ ${created.amountNts.toLocaleString()}`, `Check-in ${created.checkInAt}, check-out ${created.checkOutAt}, total NT$ ${created.amountNts.toLocaleString()}`)}</p>
        <Button onClick={onViewBookings} variant="outline">{text('查看預約管理', 'View bookings')}</Button>
      </Notice> : null}
      {multiCreated ? <Notice tone={multiCreated.created.length > 0 ? 'success' : 'warning'} title={text(`多時段預約完成：建立 ${multiCreated.created.length} 筆`, `Multi-slot booking completed: ${multiCreated.created.length} created`)}>
        {multiCreated.created.length > 0 ? <p>{text(`已建立：${multiCreated.created.map((item) => `#${item.slotNumber} ${item.bookingId}`).join('、')}`, `Created: ${multiCreated.created.map((item) => `#${item.slotNumber} ${item.bookingId}`).join(', ')}`)}</p> : null}
        {multiCreated.conflicts.length > 0 ? <p>{text(`未建立時段：${multiCreated.conflicts.map((item) => `#${item.slotNumber}${item.reason === 'past_time' ? '（已過期）' : item.reason === 'room_unavailable' ? '（房間不可用）' : `（與 ${item.conflict?.id ?? '既有資料'} 衝突）`}`).join('、')}`, `Not created: ${multiCreated.conflicts.map((item) => `#${item.slotNumber} (${item.reason === 'conflict' ? `conflict: ${item.conflict?.id ?? ''}` : item.reason})`).join(', ')}`)}</p> : null}
        <p>{text('結果依單機版規則可部分成功；每次建立已在同一個雲端交易中重新檢查。', 'The result may partially succeed like v3; every created slot was rechecked in one cloud transaction.')}</p>
        <Button onClick={onViewBookings} variant="outline">{text('查看預約管理', 'View bookings')}</Button>
      </Notice> : null}
      <form className="booking-create-form" ref={formRef} onSubmit={(event) => void submit(event)}>
        <div className="booking-create-grid">
          <Field label={text('房間', 'Room')}><select disabled={!gateway || rooms === null || roomError} name="roomId" required defaultValue="">
            <option disabled value="">{text('選擇房間', 'Select a room')}</option>
            {(rooms ?? []).map((room) => <option disabled={room.status === '月租套房'} key={room.roomId} value={room.roomId}>{room.roomId} · {roomStatusLabel(room.status, text)}</option>)}
          </select></Field>
          <Field label={text('住客姓名', 'Guest name')}><input disabled={!gateway} maxLength={300} name="guestName" required /></Field>
          <Field label={text('電話', 'Phone')}><input disabled={!gateway} maxLength={100} name="phone" inputMode="tel" /></Field>
          <Field label={text('入住時間', 'Check-in')}><input disabled={!gateway} name="checkInAt" onChange={(event) => { setCheckInLocal(event.target.value); rate.onCheckInChange(event.target.value); }} required type="datetime-local" value={checkInLocal} /></Field>
          <CheckoutPreviewField quote={quote} />
          <Field label={text('方案', 'Plan')}><select disabled={!gateway} name="plan" onChange={(event) => setPlan(event.target.value === '12hrs' ? '12hrs' : '24hrs')} value={plan}><option value="12hrs">12hrs</option><option value="24hrs">24hrs</option></select></Field>
          <Field label={text('天數', 'Days')}><input disabled={!gateway} max="366" min="1" name="days" onChange={(event) => setDays(Number(event.target.value) || 0)} required type="number" value={days || ''} /></Field>
          <Field label={text('折扣（NT$）', 'Discount (NT$)')}><input disabled={!gateway} min="0" name="discountNts" onChange={(event) => setDiscountNts(Number(event.target.value) || 0)} required type="number" value={discountNts} /></Field>
          <AmountField disabled={!gateway} manualAmountNts={manualAmountNts} onChange={setManualAmountNts} quote={quote} />
          <RateTypeField disabled={!gateway} rate={rate} />
        </div>
        <RateReference />
        <fieldset className="booking-deposit"><legend>{text('押金收款（選填）', 'Deposit payment (optional)')}</legend><div className="booking-create-grid">
          <Field label={text('押金（NT$）', 'Deposit (NT$)')}><input defaultValue="0" disabled={!gateway} min="0" name="depositAmountNts" type="number" /></Field>
          <Field label={text('付款方式', 'Payment method')}><select disabled={!gateway} name="depositPaymentType" defaultValue="cash"><option value="cash">{text('現金', 'Cash')}</option><option value="transfer">{text('轉帳', 'Transfer')}</option><option value="card">{text('刷卡', 'Card')}</option><option value="other">{text('其他', 'Other')}</option></select></Field>
        </div></fieldset>
        <section className="booking-multi-slots" aria-label={text('多時段預約', 'Multi-slot booking')}>
          <div className="booking-multi-heading"><div><strong>{text('多時段預約', 'Multi-slot booking')}</strong><small>{text('新增的每個時段共用住客與押金；衝突時只略過該時段。', 'Additional slots share guest and deposit; only conflicting slots are skipped.')}</small></div><Button disabled={!gateway || !multiGateway || rooms === null || roomError || multiSlots.length >= 11} onClick={() => setMultiSlots((current) => [...current, emptyMultiSlot()])} type="button" variant="outline">＋ {text('新增時段', 'Add slot')}</Button></div>
          {multiSlots.map((slot, index) => <article className="booking-multi-slot" key={slot.key}>
            <div className="booking-multi-slot-heading"><strong>{text(`時段 ${index + 2}`, `Slot ${index + 2}`)}</strong><Button onClick={() => setMultiSlots((current) => current.filter((item) => item.key !== slot.key))} size="sm" type="button" variant="ghost">{text('移除', 'Remove')}</Button></div>
            <div className="booking-create-grid">
              <Field label={text('房間', 'Room')}><select disabled={!gateway || !multiGateway || rooms === null || roomError} value={slot.roomId} onChange={(event) => updateMultiSlot(slot.key, { roomId: event.target.value })} required><option disabled value="">{text('選擇房間', 'Select a room')}</option>{(rooms ?? []).map((room) => <option disabled={room.status === '月租套房'} key={room.roomId} value={room.roomId}>{room.roomId} · {roomStatusLabel(room.status, text)}</option>)}</select></Field>
              <Field label={text('入住時間', 'Check-in')}><input disabled={!gateway || !multiGateway} required type="datetime-local" value={slot.checkInAt} onChange={(event) => updateMultiSlot(slot.key, { checkInAt: event.target.value })} /></Field>
              <CheckoutPreviewField quote={quoteForForm(slot.checkInAt, slot.plan, slot.days, slot.discountNts, calendar)} />
              <Field label={text('方案', 'Plan')}><select disabled={!gateway || !multiGateway} value={slot.plan} onChange={(event) => updateMultiSlot(slot.key, { plan: event.target.value === '12hrs' ? '12hrs' : '24hrs' })}><option value="12hrs">12hrs</option><option value="24hrs">24hrs</option></select></Field>
              <Field label={text('天數', 'Days')}><input disabled={!gateway || !multiGateway} max="366" min="1" required type="number" value={slot.days} onChange={(event) => updateMultiSlot(slot.key, { days: Number(event.target.value) })} /></Field>
              <Field label={text('折扣（NT$）', 'Discount (NT$)')}><input disabled={!gateway || !multiGateway} min="0" required type="number" value={slot.discountNts} onChange={(event) => updateMultiSlot(slot.key, { discountNts: Number(event.target.value) })} /></Field>
              <AmountField disabled={!gateway || !multiGateway} manualAmountNts={slot.manualAmountNts} onChange={(value) => updateMultiSlot(slot.key, { manualAmountNts: value })} quote={quoteForForm(slot.checkInAt, slot.plan, slot.days, slot.discountNts, calendar)} />
            </div>
          </article>)}
        </section>
        <div className="booking-preview-actions"><Button disabled={!previewGateway || !gateway || rooms === null || roomError} loading={previewBusy} onClick={() => void runPreview()} type="button" variant="outline">{multiSlots.length > 0 ? text('檢查首時段可用性與報價', 'Check first-slot availability & quote') : text('檢查可用性與報價', 'Check availability & quote')}</Button><small>{multiSlots.length > 0 ? text('此處僅預覽首時段；所有時段會在建立時由伺服器於同一交易中重新驗證。', 'This previews only the first slot; the server revalidates every slot in one transaction when creating.') : text('此為送出前預覽；建立時伺服器仍會重新驗證。', 'This is a pre-submit preview; the server validates again on creation.')}</small></div>
        {previewError ? <Notice tone="danger" title={text('無法取得預覽', 'Preview unavailable')}>{previewError}</Notice> : null}
        {preview ? <Notice tone={preview.available ? 'success' : 'warning'} title={preview.available ? text('此時段可預約', 'This slot is available') : text('此時段不可預約', 'This slot is unavailable')}>
          <p>{text(`入住 ${preview.quote.checkInAt}，退房 ${preview.quote.checkOutAt}，${preview.quote.rateType}，原價 NT$ ${preview.quote.grossAmountNts.toLocaleString()}，折扣 NT$ ${preview.quote.discountNts.toLocaleString()}，應收 NT$ ${preview.quote.amountNts.toLocaleString()}`, `Check-in ${preview.quote.checkInAt}, check-out ${preview.quote.checkOutAt}, ${preview.quote.rateType}, gross NT$ ${preview.quote.grossAmountNts.toLocaleString()}, discount NT$ ${preview.quote.discountNts.toLocaleString()}, total NT$ ${preview.quote.amountNts.toLocaleString()}`)}</p>
          {!preview.available ? <p>{preview.reason === 'past_time' ? text('入住時間不可早於目前時間五分鐘以上。', 'Check-in cannot be more than five minutes in the past.') : preview.reason === 'room_unavailable' ? text('找不到房間或此房為月租套房，不能建立短期預約。', 'The room is unavailable or monthly-only.') : text(`與 ${preview.conflict?.id ?? ''} 的既有時段衝突。`, `Conflicts with ${preview.conflict?.id ?? ''}.`)}</p> : null}
        </Notice> : null}
        {error ? <Notice tone="danger" title={text('無法建立預約', 'Booking could not be created')}>{error}</Notice> : null}
        <div className="booking-create-actions"><Button disabled={!gateway || rooms === null || roomError} loading={busy} size="lg" type="submit">{text('建立預約', 'Create booking')}</Button><Button onClick={onViewBookings} type="button" variant="outline">{text('返回預約管理', 'Back to bookings')}</Button></div>
      </form>
    </SectionCard>
  );
}
