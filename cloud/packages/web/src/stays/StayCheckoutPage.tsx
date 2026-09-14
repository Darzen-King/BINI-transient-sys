import {
  quoteStayCheckoutCorrection,
  quoteStayCheckoutOverdue,
  summarizeStayPayments,
  type ActiveStayItem,
  type BookingHolidayCalendar,
  type PaymentListItem,
  type StayCheckoutOverdueQuote,
  type StayCheckoutResult,
} from '@bini/cloud-shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { StaffSession } from '../auth/session.js';
import { Button, Field, Notice, NumberStepper, ResponsiveDialog, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { PaymentListGateway } from '../payments/payment-list.js';
import type { ActiveStaysGateway } from './active-stays.js';
import type { HolidayCalendarGateway } from './holiday-calendar.js';
import type { StayCheckoutGateway } from './stay-checkout.js';

const FREE_CANCEL_MS = 15 * 60_000;
const EMPTY_CALENDAR: BookingHolidayCalendar = { days: new Map(), coveredYears: new Set() };
const money = (value: number) => `NT$ ${value.toLocaleString()}`;
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;
/** 9,687 minutes → 「6 天 17 小時 27 分」. */
export function formatDuration(totalMinutes: number, locale: 'zh-TW' | 'en'): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(minutes / 1_440); const hours = Math.floor((minutes % 1_440) / 60); const rest = minutes % 60;
  const parts = locale === 'zh-TW'
    ? [days ? `${days} 天` : '', hours ? `${hours} 小時` : '', rest || (!days && !hours) ? `${rest} 分` : '']
    : [days ? `${days}d` : '', hours ? `${hours}h` : '', rest || (!days && !hours) ? `${rest}m` : ''];
  return parts.filter(Boolean).join(' ');
}
const taipeiTime = (iso: string) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

type Step =
  | { kind: 'idle' }
  | { kind: 'overdue'; quote: StayCheckoutOverdueQuote; clickedAt: number; correcting: boolean; hours: string }
  | { kind: 'balance'; overrideNts: number | null; overdueFeeNts: number };

/**
 * v3 checkout: summary with received amount and balance, then on submit an overdue confirmation
 * (confirm the system fee or correct the real hours) and a balance-collection reminder.
 * Every amount shown here is a preview; `stayCheckout` recalculates on the server.
 */
export function StayCheckoutPage({ session, gateway, staysGateway, paymentListGateway, holidayGateway, initialRoomId, onInitialRoomHandled, onBack }: { session: StaffSession; gateway: StayCheckoutGateway | undefined; staysGateway: ActiveStaysGateway | undefined; paymentListGateway?: PaymentListGateway | undefined; holidayGateway?: HolidayCalendarGateway | undefined; initialRoomId?: string | null; onInitialRoomHandled?: () => void; onBack: () => void }) {
  const { locale, text } = useLocale();
  const [stays, setStays] = useState<ActiveStayItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [payments, setPayments] = useState<PaymentListItem[] | null>(null);
  const [calendar, setCalendar] = useState<BookingHolidayCalendar | null>(null);
  const [stayId, setStayId] = useState('');
  const [extraFeeNts, setExtraFeeNts] = useState(0);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [operationId, setOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StayCheckoutResult | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => staysGateway?.subscribe(session.propertyId, (value) => { setStays(value); setLoadError(false); }, () => { setStays(null); setLoadError(true); }), [session.propertyId, staysGateway]);
  useEffect(() => paymentListGateway?.subscribe(session.propertyId, setPayments, () => setPayments(null)), [paymentListGateway, session.propertyId]);
  useEffect(() => holidayGateway?.subscribe(session.propertyId, setCalendar, () => setCalendar(null)), [holidayGateway, session.propertyId]);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(interval); }, []);
  // Room chosen on a room card: select its active stay once stays load.
  useEffect(() => {
    if (!initialRoomId || stays === null) return;
    const match = stays.find((item) => item.roomId === initialRoomId);
    if (match) setStayId(match.stayId);
    onInitialRoomHandled?.();
  }, [initialRoomId, onInitialRoomHandled, stays]);
  const stay = useMemo(() => stays?.find((item) => item.stayId === stayId) ?? null, [stays, stayId]);
  const ready = Boolean(gateway && staysGateway && stays && !loadError);
  const minutesSinceCheckIn = stay ? Math.floor((now - Date.parse(stay.checkInAt)) / 60_000) : 0;
  const freeCancel = Boolean(stay && now - Date.parse(stay.checkInAt) >= 0 && now - Date.parse(stay.checkInAt) <= FREE_CANCEL_MS);
  const paid = stay && payments ? summarizeStayPayments(stay, payments) : null;
  // Live estimate shown in the summary (refreshed every 30 s); the confirm step and the server recalculate at check-out time.
  const liveOverdue = useMemo(() => {
    if (!stay || freeCancel) return null;
    try { return quoteStayCheckoutOverdue(stay.checkInAt, stay.checkOutAt, stay.extensionFeeNts, new Date(now).toISOString(), calendar ?? EMPTY_CALENDAR); } catch { return null; }
  }, [calendar, freeCancel, now, stay]);
  const liveOverdueFee = liveOverdue?.overdue ? liveOverdue.systemOverdueFeeNts : 0;
  const minutesPastCheckOut = stay ? (now - Date.parse(stay.checkOutAt)) / 60_000 : 0;
  const projectedTotal = stay ? stay.totalDueNts + liveOverdueFee + extraFeeNts : 0;

  const finish = async (overdueFeeOverrideNts: number | null) => {
    if (!gateway || !stay) return;
    const id = operationId ?? crypto.randomUUID();
    if (!operationId) setOperationId(id);
    setStep({ kind: 'idle' });
    setBusy(true);
    setError('');
    try {
      setResult(await gateway.checkout({ propertyId: session.propertyId, operationId: id, stayId: stay.stayId, extraFeeNts, overdueFeeOverrideNts }));
      setOperationId(null);
      setStayId('');
      setExtraFeeNts(0);
    } catch (failure) {
      setError(message(failure, text('退房未完成，請重新確認資料。', 'Checkout did not complete. Confirm the data and try again.')));
    } finally {
      setBusy(false);
    }
  };
  // Step 2: remind staff to collect any balance (never inside the free-cancel window, where nothing is collectable).
  const remindBalance = (overrideNts: number | null, overdueFeeNts: number) => {
    if (!stay) return;
    const clickedAt = Date.now();
    const stillFree = clickedAt - Date.parse(stay.checkInAt) <= FREE_CANCEL_MS;
    const balance = paid ? stay.totalDueNts + overdueFeeNts + extraFeeNts - paid.totalPaidNts : 0;
    if (stillFree || balance <= 0) { void finish(overrideNts); return; }
    setStep({ kind: 'balance', overrideNts, overdueFeeNts });
  };
  // Step 1: overdue confirmation, like v3 `checkOverdueAndConfirm`.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stay || busy) return;
    setResult(null);
    const clickedAt = new Date();
    if (clickedAt.getTime() - Date.parse(stay.checkInAt) <= FREE_CANCEL_MS) { remindBalance(null, 0); return; }
    const quote = quoteStayCheckoutOverdue(stay.checkInAt, stay.checkOutAt, stay.extensionFeeNts, clickedAt.toISOString(), calendar ?? EMPTY_CALENDAR);
    if (!quote.overdue) { remindBalance(null, 0); return; }
    setStep({ kind: 'overdue', quote, clickedAt: clickedAt.getTime(), correcting: false, hours: String(quote.overdueHours) });
  };
  const correctionFee = step.kind === 'overdue' && stay ? quoteStayCheckoutCorrection(stay.checkInAt, stay.checkOutAt, Number(step.hours) || 0, calendar ?? EMPTY_CALENDAR) : 0;

  return <SectionCard hint={text('伺服器交易驗證', 'Server-authoritative transaction')} title={text('退房辦理', 'Check-out')}>
    <p className="booking-create-intro">{text('系統會以伺服器時間計算免費取消、退房緩衝與逾時費，並同步建立退款、住宿紀錄與稽核資料。', 'The server calculates free cancellation, grace period, and overdue fees, then writes refunds, stay history, and audit data together.')}</p>
    {!ready ? <Notice tone={loadError ? 'danger' : 'warning'} title={text('退房資料尚未就緒', 'Checkout data is not ready')}>{text('在住房資料載入失敗或尚未完成前，不提供送出。', 'Submission is disabled until live stay data is ready.')}</Notice> : null}
    {result ? <Notice tone="success" title={text('退房已完成', 'Check-out complete')}>
      <p>{result.freeCancel ? text(`房間 ${result.roomId} 已免費取消並轉為待清潔${result.refundedDepositNts > 0 ? `；押金 ${money(result.refundedDepositNts)} 已自動退還` : ''}。`, `Room ${result.roomId} was cancelled free of charge and is now waiting for cleaning${result.refundedDepositNts > 0 ? `; the ${money(result.refundedDepositNts)} deposit was refunded` : ''}.`) : text(`房間 ${result.roomId} 已轉為待清潔；本次應收 ${money(result.totalChargedNts)}${result.appliedOverdueFeeNts > 0 ? `（含逾時費 ${money(result.appliedOverdueFeeNts)}）` : ''}。`, `Room ${result.roomId} is now waiting for cleaning; charged ${money(result.totalChargedNts)}${result.appliedOverdueFeeNts > 0 ? ` (incl. ${money(result.appliedOverdueFeeNts)} overdue)` : ''}.`)}</p>
      <Button onClick={onBack} variant="outline">{text('返回房間總覽', 'Back to rooms')}</Button>
    </Notice> : null}
    <form className="booking-create-form" onSubmit={submit}>
      <div className="booking-create-grid">
        <Field label={text('選擇在住房', 'Select active stay')}><select disabled={!ready} onChange={(event) => { setStayId(event.target.value); setResult(null); setError(''); setOperationId(null); }} required value={stayId}><option value="">{text('選擇房間與旅客', 'Select room and guest')}</option>{(stays ?? []).map((item) => <option key={item.stayId} value={item.stayId}>{item.roomId} · {item.guestName}</option>)}</select></Field>
        <Field label={text('額外費用（NT$）', 'Extra fee (NT$)')}><input disabled={!ready || !stay} min="0" onChange={(event) => setExtraFeeNts(Number(event.target.value) || 0)} type="number" value={extraFeeNts} /></Field>
      </div>
      {stay ? <div className="stay-extension-preview checkout-summary">
        <strong>{text('退房摘要', 'Checkout summary')}</strong>
        <div><span>{text('旅客／方案', 'Guest / plan')}</span><b>{stay.guestName} · {stay.plan ?? '—'}</b></div>
        <div><span>{text('基本房租', 'Base rent')}</span><b className={freeCancel ? 'struck' : ''}>{money(stay.baseRentNts)}</b></div>
        {!freeCancel && stay.extensionFeeNts > 0 ? <div><span>{text('延住費', 'Extension fee')}</span><b>{money(stay.extensionFeeNts)}</b></div> : null}
        {!freeCancel && stay.extraFeeNts > 0 ? <div><span>{text('已記雜費', 'Recorded extras')}</span><b>{money(stay.extraFeeNts)}</b></div> : null}
        {freeCancel ? <p className="checkout-note free">{text(`15 分鐘免費取消 · 已入住 ${Math.max(0, minutesSinceCheckIn)} 分鐘 · 應收 NT$ 0${paid && paid.depositPaidNts > 0 ? ` · 押金 ${money(paid.depositPaidNts)} 將自動退還` : ''}`, `15-minute free cancel · checked in ${Math.max(0, minutesSinceCheckIn)} min ago · total NT$ 0${paid && paid.depositPaidNts > 0 ? ` · the ${money(paid.depositPaidNts)} deposit will be refunded` : ''}`)}</p>
          : <p className="checkout-note">{text(`退房緩衝 15 分鐘：${taipeiTime(stay.checkOutAt)} 起算，逾時費自 ${taipeiTime(stay.checkOutAt)} 計`, `15-minute grace after ${taipeiTime(stay.checkOutAt)}; overdue fees accrue from ${taipeiTime(stay.checkOutAt)}`)}</p>}
        {liveOverdue?.overdue ? <>
          <div className="checkout-overdue"><span>{text(`逾時費（已過退房 ${formatDuration(minutesPastCheckOut, locale)}，計 ${liveOverdue.overdueHours} 小時）`, `Overdue fee (${formatDuration(minutesPastCheckOut, locale)} past check-out, ${liveOverdue.overdueHours} h billed)`)}</span><b>{money(liveOverdue.systemOverdueFeeNts)}</b></div>
          <p className="checkout-note overdue">{text('系統預估。按「確認辦理退房」後可確認；若是服務人員忘了退房、客人早已離開，可在「修正」中改時數或免收。', 'Estimated now. Confirm it at check-out, or use Correct to change the hours or waive it if staff forgot to check the guest out.')}</p>
        </> : null}
        <div className="checkout-total"><span>{text('應付總金額', 'Total due')}</span><b>{freeCancel ? 'NT$ 0' : money(projectedTotal)}</b></div>
        {!freeCancel && paid ? <>
          <div><span>{text('已收款', 'Received')}</span><b>{money(paid.totalPaidNts)}</b></div>
          {paid.depositPaidNts > 0 ? <div className="indent"><span>{text('↳ 含押金', '↳ incl. deposit')}</span><b>{money(paid.depositPaidNts)}</b></div> : null}
          <div className={`checkout-balance ${projectedTotal - paid.totalPaidNts > 0 ? 'due' : 'settled'}`}><span>{text('餘額應收', 'Balance due')}</span><b>{money(Math.max(0, projectedTotal - paid.totalPaidNts))}{projectedTotal - paid.totalPaidNts <= 0 ? text(' · 已結清', ' · settled') : ''}</b></div>
        </> : null}
        {!freeCancel ? <small>{text('延住費率：NT$ 200／小時', 'Extension rate: NT$ 200 per hour')}</small> : null}
      </div> : null}
      {error ? <Notice tone="danger" title={text('無法完成退房', 'Checkout could not be completed')}>{error}</Notice> : null}
      <div className="booking-create-actions"><Button disabled={!ready || !stay} loading={busy} size="lg" type="submit">{text('確認辦理退房', 'Confirm check-out')}</Button><Button onClick={onBack} type="button" variant="outline">{text('取消', 'Cancel')}</Button></div>
    </form>
    {step.kind === 'overdue' && stay ? <ResponsiveDialog onClose={() => setStep({ kind: 'idle' })} title={text('超時退房確認', 'Overdue check-out')}>
      {!step.correcting ? <>
        <Notice tone="danger" title={text(`已超過退房時間，將產生 ${money(step.quote.systemOverdueFeeNts)} 的延住費用，確認嗎？`, `Past check-out: an extension fee of ${money(step.quote.systemOverdueFeeNts)} applies. Confirm?`)}>
          {text(`預計退房：${taipeiTime(stay.checkOutAt)} · 已過退房：${formatDuration((step.clickedAt - Date.parse(stay.checkOutAt)) / 60_000, locale)}（計 ${step.quote.overdueHours} 小時）`, `Planned check-out: ${taipeiTime(stay.checkOutAt)} · ${formatDuration((step.clickedAt - Date.parse(stay.checkOutAt)) / 60_000, locale)} past it (${step.quote.overdueHours} h billed)`)}
        </Notice>
        <p className="checkout-dialog-hint">{text('房客確實延住請按「確認」；若是服務人員忘了退房，請按「修正」輸入實際超時時數，或直接免收。', 'Choose Confirm if the guest really stayed longer; choose Correct to change the hours or waive the fee if staff forgot to check them out.')}</p>
        <div className="booking-detail-actions"><Button onClick={() => remindBalance(null, step.quote.systemOverdueFeeNts)} variant="danger">{text('確認', 'Confirm')}</Button><Button onClick={() => setStep({ ...step, correcting: true })} variant="outline">{text('修正', 'Correct')}</Button><Button onClick={() => setStep({ kind: 'idle' })} variant="ghost">{text('取消', 'Cancel')}</Button></div>
      </> : <>
        <Notice tone="info" title={text(`請輸入實際超時時數（從預定退房 ${taipeiTime(stay.checkOutAt)} 起算）`, `Enter the real hours past ${taipeiTime(stay.checkOutAt)}`)}>{text('客人已準時離開、只是忘了按退房：輸入 0 或按「免收逾時費」。', 'If the guest left on time and staff forgot to check out, enter 0 or choose Waive overdue fee.')}</Notice>
        <Field label={text('超時時間（小時）', 'Overdue hours')}><NumberStepper decrementLabel={text('減少 1 小時', 'One hour less')} incrementLabel={text('增加 1 小時', 'One hour more')} max={step.quote.overdueHours} min={0} onChange={(hours) => setStep({ ...step, hours: String(hours) })} value={Number(step.hours) || 0} /></Field>
        <p className="checkout-dialog-fee">{text('調整後延住費用：', 'Adjusted extension fee: ')}<strong>{money(correctionFee)}</strong></p>
        <div className="booking-detail-actions"><Button onClick={() => remindBalance(correctionFee, correctionFee)} variant="primary">{text('套用修正，確認退房', 'Apply correction and check out')}</Button><Button onClick={() => remindBalance(0, 0)} variant="outline">{text('免收逾時費，確認退房', 'Waive overdue fee and check out')}</Button><Button onClick={() => setStep({ ...step, correcting: false })} variant="ghost">{text('返回', 'Back')}</Button></div>
      </>}
    </ResponsiveDialog> : null}
    {step.kind === 'balance' && stay && paid ? <ResponsiveDialog onClose={() => setStep({ kind: 'idle' })} title={text('請收取餘額', 'Collect the balance')}>
      <Notice tone="warning" title={text('退房前請確認已向房客收取以下費用', 'Confirm the guest has paid the following before check-out')} />
      <div className="stay-extension-preview">
        <div><span>{text('應付總金額', 'Total due')}</span><b>{money(stay.totalDueNts + step.overdueFeeNts + extraFeeNts)}</b></div>
        <div><span>{text('已收款', 'Received')}</span><b>{money(paid.totalPaidNts)}</b></div>
        <div className="checkout-balance due"><span>{text('餘額應收', 'Balance due')}</span><b>{money(stay.totalDueNts + step.overdueFeeNts + extraFeeNts - paid.totalPaidNts)}</b></div>
      </div>
      <p className="checkout-dialog-hint">{text('確認收款完成後，點「已收款，確認退房」完成退房手續。', 'After collecting payment, choose "Paid — check out" to finish.')}</p>
      <div className="booking-detail-actions"><Button onClick={() => void finish(step.overrideNts)} variant="primary">{text('已收款，確認退房', 'Paid — check out')}</Button><Button onClick={() => setStep({ kind: 'idle' })} variant="ghost">{text('取消', 'Cancel')}</Button></div>
    </ResponsiveDialog> : null}
  </SectionCard>;
}
