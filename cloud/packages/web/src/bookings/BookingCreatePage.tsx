import { useEffect, useRef, useState, type FormEvent } from 'react';
import { type BookingCreateResult, type BookingPreviewResult, type BookingRoomOption } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import { Button, Field, Notice, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { BookingCreateGateway } from './booking-create.js';
import type { BookingPreviewGateway } from './booking-preview.js';
import type { BookingRoomGateway } from '../rooms/booking-room-options.js';

function toTaipeiIso(value: string): string {
  const normalized = value.length === 16 ? `${value}:00` : value;
  return `${normalized}+08:00`;
}

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

export function BookingCreatePage({
  session,
  gateway,
  previewGateway,
  roomGateway,
  onViewBookings,
}: {
  session: StaffSession;
  gateway: BookingCreateGateway | undefined;
  previewGateway: BookingPreviewGateway | undefined;
  roomGateway: BookingRoomGateway | undefined;
  onViewBookings: () => void;
}) {
  const { text } = useLocale();
  const [rooms, setRooms] = useState<BookingRoomOption[] | null>(null);
  const [roomError, setRoomError] = useState(false);
  const [pricingMode, setPricingMode] = useState<'automatic' | 'manual'>('automatic');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<BookingCreateResult | null>(null);
  const [preview, setPreview] = useState<BookingPreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

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
    const data = new FormData(event.currentTarget);
    const depositAmountNts = Number(data.get('depositAmountNts') || 0);
    const operationId = pendingOperationId ?? crypto.randomUUID();
    if (!pendingOperationId) setPendingOperationId(operationId);
    setBusy(true);
    setError('');
    setCreated(null);
    try {
      const result = await gateway.create({
        propertyId: session.propertyId,
        operationId,
        roomId: String(data.get('roomId') ?? ''),
        guestName: String(data.get('guestName') ?? ''),
        phone: String(data.get('phone') ?? '').trim() || null,
        checkInAt: toTaipeiIso(String(data.get('checkInAt') ?? '')),
        plan: String(data.get('plan')) === '12hrs' ? '12hrs' : '24hrs',
        days: Number(data.get('days') || 0),
        discountNts: Number(data.get('discountNts') || 0),
        pricingMode,
        ...(pricingMode === 'manual' ? { manualAmountNts: Number(data.get('manualAmountNts') || 0) } : {}),
        ...(depositAmountNts > 0 ? {
          deposit: {
            amountNts: depositAmountNts,
            paymentType: String(data.get('depositPaymentType')) as 'cash' | 'transfer' | 'card' | 'other',
          },
        } : {}),
      });
      setCreated(result);
      event.currentTarget.reset();
      setPricingMode('automatic');
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
        checkInAt: toTaipeiIso(String(data.get('checkInAt') ?? '')),
        plan: String(data.get('plan')) === '12hrs' ? '12hrs' : '24hrs',
        days: Number(data.get('days') || 0),
        discountNts: Number(data.get('discountNts') || 0),
        pricingMode,
        ...(pricingMode === 'manual' ? { manualAmountNts: Number(data.get('manualAmountNts') || 0) } : {}),
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
      <form className="booking-create-form" ref={formRef} onSubmit={(event) => void submit(event)}>
        <div className="booking-create-grid">
          <Field label={text('房間', 'Room')}><select disabled={!gateway || rooms === null || roomError} name="roomId" required defaultValue="">
            <option disabled value="">{text('選擇房間', 'Select a room')}</option>
            {(rooms ?? []).map((room) => <option disabled={room.status === '月租套房'} key={room.roomId} value={room.roomId}>{room.roomId} · {roomStatusLabel(room.status, text)}</option>)}
          </select></Field>
          <Field label={text('住客姓名', 'Guest name')}><input disabled={!gateway} maxLength={300} name="guestName" required /></Field>
          <Field label={text('電話', 'Phone')}><input disabled={!gateway} maxLength={100} name="phone" inputMode="tel" /></Field>
          <Field label={text('入住時間', 'Check-in')}><input disabled={!gateway} name="checkInAt" required type="datetime-local" /></Field>
          <Field label={text('方案', 'Plan')}><select disabled={!gateway} name="plan" defaultValue="24hrs"><option value="12hrs">12hrs</option><option value="24hrs">24hrs</option></select></Field>
          <Field label={text('天數', 'Days')}><input defaultValue="1" disabled={!gateway} max="366" min="1" name="days" required type="number" /></Field>
          <Field label={text('折扣（NT$）', 'Discount (NT$)')}><input defaultValue="0" disabled={!gateway} min="0" name="discountNts" required type="number" /></Field>
          <Field label={text('計價方式', 'Pricing')}><select disabled={!gateway} name="pricingMode" onChange={(event) => setPricingMode(event.target.value === 'manual' ? 'manual' : 'automatic')} value={pricingMode}><option value="automatic">{text('自動計價', 'Automatic')}</option><option value="manual">{text('手動覆寫', 'Manual override')}</option></select></Field>
          {pricingMode === 'manual' ? <Field label={text('手動金額（NT$）', 'Manual amount (NT$)')}><input defaultValue="0" disabled={!gateway} min="0" name="manualAmountNts" required type="number" /></Field> : null}
        </div>
        <fieldset className="booking-deposit"><legend>{text('押金收款（選填）', 'Deposit payment (optional)')}</legend><div className="booking-create-grid">
          <Field label={text('押金（NT$）', 'Deposit (NT$)')}><input defaultValue="0" disabled={!gateway} min="0" name="depositAmountNts" type="number" /></Field>
          <Field label={text('付款方式', 'Payment method')}><select disabled={!gateway} name="depositPaymentType" defaultValue="cash"><option value="cash">{text('現金', 'Cash')}</option><option value="transfer">{text('轉帳', 'Transfer')}</option><option value="card">{text('刷卡', 'Card')}</option><option value="other">{text('其他', 'Other')}</option></select></Field>
        </div></fieldset>
        <div className="booking-preview-actions"><Button disabled={!previewGateway || !gateway || rooms === null || roomError} loading={previewBusy} onClick={() => void runPreview()} type="button" variant="outline">{text('檢查可用性與報價', 'Check availability & quote')}</Button><small>{text('此為送出前預覽；建立時伺服器仍會重新驗證。', 'This is a pre-submit preview; the server validates again on creation.')}</small></div>
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
