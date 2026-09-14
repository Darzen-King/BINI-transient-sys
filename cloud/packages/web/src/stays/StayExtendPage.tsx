import { quoteStayExtension, type ActiveStayItem, type BookingHolidayCalendar, type StayExtendResult } from '@bini/cloud-shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { StaffSession } from '../auth/session.js';
import { Button, Field, NumberStepper, Notice, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { ActiveStaysGateway } from './active-stays.js';
import type { HolidayCalendarGateway } from './holiday-calendar.js';
import type { StayExtendGateway } from './stay-extend.js';

function formatTaipei(value: string, locale: 'zh-TW' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'zh-TW' ? 'zh-TW' : 'en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}
function errorMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }

export function StayExtendPage({ session, gateway, staysGateway, holidayGateway, initialRoomId, onInitialRoomHandled, onBack }: {
  session: StaffSession;
  gateway: StayExtendGateway | undefined;
  staysGateway: ActiveStaysGateway | undefined;
  holidayGateway: HolidayCalendarGateway | undefined;
  /** Room chosen on a room card; its active stay is selected as soon as stays load. */
  initialRoomId?: string | null;
  onInitialRoomHandled?: () => void;
  onBack: () => void;
}) {
  const { locale, text } = useLocale();
  const [stays, setStays] = useState<ActiveStayItem[] | null>(null);
  const [calendar, setCalendar] = useState<BookingHolidayCalendar | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [stayId, setStayId] = useState('');
  const [extensionHours, setExtensionHours] = useState(2);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<StayExtendResult | null>(null);
  const selectedStay = useMemo(() => stays?.find((stay) => stay.stayId === stayId) ?? null, [stays, stayId]);
  const preview = useMemo(() => {
    if (!selectedStay || !calendar || !Number.isInteger(extensionHours) || extensionHours < 1) return null;
    try {
      const current = quoteStayExtension(selectedStay.checkInAt, selectedStay.checkOutAt, extensionHours, calendar);
      const fullHours = (Date.parse(selectedStay.checkOutAt) + (extensionHours * 3_600_000) - Date.parse(selectedStay.originalCheckOutAt)) / 3_600_000;
      const cumulative = quoteStayExtension(selectedStay.checkInAt, selectedStay.originalCheckOutAt, fullHours, calendar);
      return { current, cumulative, checkOutAt: new Date(Date.parse(selectedStay.checkOutAt) + (extensionHours * 3_600_000)).toISOString(), totalDueNts: selectedStay.baseRentNts + cumulative.extensionFeeNts + selectedStay.extraFeeNts };
    } catch { return null; }
  }, [calendar, extensionHours, selectedStay]);

  useEffect(() => staysGateway?.subscribe(session.propertyId, (value) => { setStays(value); setLoadError(false); }, () => { setStays(null); setLoadError(true); }), [session.propertyId, staysGateway]);
  useEffect(() => holidayGateway?.subscribe(session.propertyId, (value) => { setCalendar(value); setLoadError(false); }, () => { setCalendar(null); setLoadError(true); }), [holidayGateway, session.propertyId]);

  useEffect(() => {
    if (!initialRoomId || stays === null) return;
    const match = stays.find((stay) => stay.roomId === initialRoomId);
    if (match) setStayId(match.stayId);
    onInitialRoomHandled?.();
  }, [initialRoomId, onInitialRoomHandled, stays]);

  const chooseStay = (nextStayId: string) => { setStayId(nextStayId); setError(''); setCompleted(null); setOperationId(null); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gateway || !selectedStay || !calendar || loadError) return;
    const nextOperationId = operationId ?? crypto.randomUUID();
    if (!operationId) setOperationId(nextOperationId);
    setBusy(true); setError(''); setCompleted(null);
    try {
      setCompleted(await gateway.extend({ propertyId: session.propertyId, operationId: nextOperationId, stayId: selectedStay.stayId, extensionHours }));
      setOperationId(null);
    } catch (submitError) { setError(errorMessage(submitError, text('延住未完成，請重新確認房態與後續預約。', 'Extension was not completed. Confirm the room and following bookings.'))); } finally { setBusy(false); }
  };
  const unavailable = !gateway || !staysGateway || !holidayGateway || stays === null || calendar === null || loadError;

  return <SectionCard hint={text('伺服器交易驗證', 'Server-authoritative transaction')} title={text('延住處理', 'Extend stay')}>
    <p className="booking-create-intro">{text('延住費依入住時間的 12 小時計價區塊累計；送出時會再次檢查下一筆預約與維修排程，若撞期則完全不寫入。', 'Extension fees stay anchored to the check-in timeline. The server rechecks bookings and maintenance before writing; conflicts make no changes.')}</p>
    {unavailable ? <Notice tone={loadError ? 'danger' : 'warning'} title={text('延住資料尚未就緒', 'Extension data is not ready')}>{text('在住房或假日資料未完整載入時，系統不提供送出。', 'Submission remains disabled until live stay and holiday data is ready.')}</Notice> : null}
    {completed ? <Notice tone="success" title={text('延住已完成', 'Stay extended')}><p>{text(`房間 ${completed.roomId} 已延住 ${completed.extensionHours} 小時；新退房時間 ${formatTaipei(completed.checkOutAt, locale)}；本次增加 NT$ ${completed.incrementalFeeNts.toLocaleString()}，應收 NT$ ${completed.totalDueNts.toLocaleString()}。`, `Room ${completed.roomId} was extended ${completed.extensionHours} hours. New checkout: ${formatTaipei(completed.checkOutAt, locale)}. This extension adds NT$ ${completed.incrementalFeeNts.toLocaleString()}, total due NT$ ${completed.totalDueNts.toLocaleString()}.`)}</p><Button onClick={onBack} variant="outline">{text('返回房間總覽', 'Back to room overview')}</Button></Notice> : null}
    <form className="booking-create-form" onSubmit={(event) => void submit(event)}>
      <div className="booking-create-grid">
        <Field label={text('選擇在住房', 'Select active stay')}><select disabled={unavailable} onChange={(event) => chooseStay(event.target.value)} required value={stayId}><option value="">{text('選擇房間與旅客', 'Select room and guest')}</option>{(stays ?? []).map((stay) => <option key={stay.stayId} value={stay.stayId}>{stay.roomId} · {stay.guestName} · {formatTaipei(stay.checkOutAt, locale)}</option>)}</select></Field>
        <Field label={text('延住時數', 'Extension hours')}><NumberStepper decrementLabel={text('減少 1 小時', 'One hour less')} disabled={unavailable || !selectedStay} incrementLabel={text('增加 1 小時', 'One hour more')} max={168} min={1} onChange={setExtensionHours} value={extensionHours} /></Field>
      </div>
      {selectedStay ? <div className="stay-extension-details">
        <dl className="room-detail-list"><div><dt>{text('旅客／方案', 'Guest / plan')}</dt><dd><strong>{selectedStay.guestName}</strong> · {selectedStay.plan ?? '—'}</dd></div><div><dt>{text('入住時間', 'Check-in')}</dt><dd>{formatTaipei(selectedStay.checkInAt, locale)}</dd></div><div><dt>{text('目前退房', 'Current checkout')}</dt><dd>{formatTaipei(selectedStay.checkOutAt, locale)}</dd></div><div><dt>{text('原始退房', 'Original checkout')}</dt><dd>{formatTaipei(selectedStay.originalCheckOutAt, locale)}</dd></div><div><dt>{text('目前延住費', 'Current extension fee')}</dt><dd>NT$ {selectedStay.extensionFeeNts.toLocaleString()}</dd></div><div><dt>{text('目前應收', 'Current total due')}</dt><dd>NT$ {selectedStay.totalDueNts.toLocaleString()}</dd></div></dl>
        {preview ? <div className="stay-extension-preview"><strong>{text('延住預覽', 'Extension preview')}</strong><div><span>{text('新退房時間', 'New checkout')}</span><b>{formatTaipei(preview.checkOutAt, locale)}</b></div><div><span>{text('本次增加', 'Added this time')}</span><b>NT$ {preview.current.extensionFeeNts.toLocaleString()}</b></div><div><span>{text('累計延住費', 'Cumulative extension fee')}</span><b>NT$ {preview.cumulative.extensionFeeNts.toLocaleString()}</b></div><div><span>{text('延住後應收', 'Projected total due')}</span><b>NT$ {preview.totalDueNts.toLocaleString()}</b></div><small>{preview.current.breakdown.map((row) => `${row.date} · ${row.hours}h · NT$ ${row.feeNts}`).join(' / ')}</small></div> : <Notice tone="warning" title={text('無法產生預覽', 'Preview unavailable')}>{text('請確認延住時數為 1 至 168 的整數小時（每小時 NT$200，不以半小時計），且在住房日期有效。', 'Use whole hours from 1 to 168 (NT$200 per hour, no half hours) and confirm the stay dates are valid.')}</Notice>}
      </div> : null}
      {error ? <Notice tone="danger" title={text('無法完成延住', 'Extension could not be completed')}>{error}</Notice> : null}
      <div className="booking-create-actions"><Button disabled={unavailable || !selectedStay || !preview} loading={busy} size="lg" type="submit">{text('確認延住', 'Confirm extension')}</Button><Button onClick={onBack} type="button" variant="outline">{text('取消', 'Cancel')}</Button></div>
    </form>
  </SectionCard>;
}
