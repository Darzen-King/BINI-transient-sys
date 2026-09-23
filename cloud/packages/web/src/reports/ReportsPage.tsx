import { useEffect, useMemo, useRef, useState } from 'react';
import { summarizePayments, type ReportDailyItem, type ReportProjection } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import { Button, Field, Notice, SectionCard } from '../design-system/index.js';
import { BOOKING_STATUS_LABELS, COST_CATEGORY_LABELS, labelFor, ROOM_STATUS_LABELS } from '../i18n/labels.js';
import { useLocale } from '../i18n/locale.js';
import type { ReportGateway, ReportPaymentLedger } from './report-gateway.js';

const DAY_MS = 86_400_000;
const taipeiDay = (at = Date.now()) => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at)); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; };
const initialRange = () => { const to = taipeiDay(); return { dateFrom: `${to.slice(0, 8)}01`, dateTo: to }; };
/** v3 quick ranges: "7D" is today plus the six days before it. */
const lastDays = (span: number) => ({ dateFrom: taipeiDay(Date.parse(`${taipeiDay()}T12:00:00+08:00`) - span * DAY_MS), dateTo: taipeiDay() });
const money = (value: number) => `NT$ ${value.toLocaleString()}`;
const errorMessage = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;
const share = (value: number, total: number) => (total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0);

function download(filename: string, csv: string) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function Metric({ label, value, detail }: { label: string; value: string; detail?: string | undefined }) { return <div><small>{label}</small><strong>{value}</strong>{detail ? <span>{detail}</span> : null}</div>; }

/** "Nice" axis maximum and step, so the revenue scale reads in round numbers (e.g. 0 / 1,000 / 2,000). */
export function niceScale(maxValue: number, ticks = 4): { max: number; step: number } {
  if (!(maxValue > 0)) return { max: ticks, step: 1 };
  const rough = maxValue / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude;
  return { max: step * ticks, step };
}
const compactMoney = (value: number) => (value >= 10_000 ? `${Math.round(value / 1_000).toLocaleString()}k` : value.toLocaleString());

/**
 * Revenue bars with an occupancy line, mirroring the v3 dual-axis daily chart without a chart library.
 * It fills the card width (scrolling only when days would get narrower than 18px), labels the revenue axis
 * on the left and occupancy on the right, and thins the date labels so they never overlap.
 */
function DailyChart({ daily, revenueLabel, occupancyLabel }: { daily: readonly ReportDailyItem[]; revenueLabel: string; occupancyLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(640);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const measure = () => setAvailable(Math.max(280, element.clientWidth - 24));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const left = 58; const right = 44; const top = 16; const bottom = 34; const height = 240;
  const slot = Math.max(18, (available - left - right) / Math.max(1, daily.length));
  const width = left + right + slot * daily.length;
  const plot = height - top - bottom;
  const scale = niceScale(Math.max(0, ...daily.map((item) => item.revenueNts)));
  const y = (value: number) => top + plot - (value / scale.max) * plot;
  const yOcc = (pct: number) => top + plot - (Math.min(100, pct) / 100) * plot;
  // One label every N days so each "MM-DD" (about 38px at 12px) has room; always label the first and last day.
  const labelEvery = Math.max(1, Math.ceil(46 / slot));
  const barWidth = Math.max(6, Math.min(34, slot * 0.6));
  const x = (index: number) => left + index * slot + slot / 2;
  const line = daily.map((item, index) => `${x(index)},${yOcc(item.occupancyPct)}`).join(' ');
  const ticks = Array.from({ length: 5 }, (_, index) => index);
  return <div className="report-chart-scroll" ref={containerRef}>
    <svg aria-label={`${revenueLabel} / ${occupancyLabel}`} className="report-daily-chart" height={height} role="img" viewBox={`0 0 ${width} ${height}`} width={width}>
      {ticks.map((index) => { const value = scale.step * index; const lineY = y(value); return <g key={index}>
        <line className={index === 0 ? 'report-chart-axis' : 'report-chart-grid'} x1={left} x2={width - right} y1={lineY} y2={lineY} />
        <text className="report-chart-tick" textAnchor="end" x={left - 8} y={lineY + 4}>{compactMoney(value)}</text>
        <text className="report-chart-tick report-chart-tick--occ" textAnchor="start" x={width - right + 8} y={lineY + 4}>{`${index * 25}%`}</text>
      </g>; })}
      {daily.map((item, index) => { const barTop = y(item.revenueNts); return <g key={item.date}>
        <rect className="report-chart-bar" height={Math.max(0, top + plot - barTop)} rx="3" width={barWidth} x={x(index) - barWidth / 2} y={barTop}><title>{`${item.date} · ${money(item.revenueNts)} · ${item.occupancyPct}%`}</title></rect>
        {(index % labelEvery === 0 && daily.length - 1 - index >= labelEvery) || index === daily.length - 1 ? <text className="report-chart-label" textAnchor="middle" x={x(index)} y={height - 12}>{item.date.slice(5)}</text> : null}
      </g>; })}
      {daily.length > 1 ? <polyline className="report-chart-line" points={line} /> : null}
      {daily.map((item, index) => <circle className="report-chart-dot" cx={x(index)} cy={yOcc(item.occupancyPct)} key={`dot-${item.date}`} r={daily.length > 45 ? 0 : 3}><title>{`${item.date} · ${occupancyLabel} ${item.occupancyPct}%`}</title></circle>)}
    </svg>
    <div className="report-chart-legend"><span className="bar">{revenueLabel}</span><span className="line">{occupancyLabel}</span></div>
  </div>;
}

function ShareBars({ rows, format }: { rows: ReadonlyArray<{ key: string; label: string; value: number }>; format: (value: number) => string }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!rows.length || total === 0) return <p className="empty-card">—</p>;
  return <div className="report-share-list">{rows.map((row) => <div key={row.key}><span>{row.label}</span><b>{format(row.value)} · {share(row.value, total)}%</b><i style={{ width: `${share(row.value, total)}%` }} /></div>)}</div>;
}

function CountTable({ counts, total, label }: { counts: Record<string, number>; total: number; label: (code: string) => string }) {
  const rows = Object.entries(counts);
  if (!rows.length) return <p className="empty-card">—</p>;
  return <div className="report-share-list">{rows.map(([status, count]) => <div key={status}><span>{label(status)}</span><b>{count}</b><i style={{ width: `${share(count, total)}%` }} /></div>)}</div>;
}

export function ReportsPage({ session, gateway, onOpenPayments }: { session: StaffSession; gateway: ReportGateway | undefined; /** Switches to Payments; omitted when this account may not open that page. */ onOpenPayments?: (() => void) | undefined }) {
  const { text } = useLocale(); const isAdmin = session.role === 'admin';
  const [range, setRange] = useState(initialRange); const [report, setReport] = useState<ReportProjection | null>(null); const [error, setError] = useState('');
  const [ledger, setLedger] = useState<ReportPaymentLedger | null>(null); const [ledgerError, setLedgerError] = useState('');
  const [exporting, setExporting] = useState<'report' | 'daily' | null>(null);
  useEffect(() => gateway?.subscribe(session.propertyId, { ...range, includeCosts: isAdmin }, (next) => { setReport(next); setError(''); }, (failure) => { setReport(null); setError(errorMessage(failure, text('無法載入統計報表。', 'Unable to load reports.'))); }), [gateway, isAdmin, range, session.propertyId, text]);
  useEffect(() => gateway?.subscribePaymentLedger?.(session.propertyId, (next) => { setLedger(next); setLedgerError(''); }, (failure) => { setLedger(null); setLedgerError(errorMessage(failure, text('無法載入付款摘要。', 'Unable to load the payment summary.'))); }), [gateway, session.propertyId, text]);
  // Like v3, the payment summary card follows the report's end date.
  const paymentDay = range.dateTo;
  const paymentSummary = useMemo(() => (ledger ? summarizePayments(ledger.payments, paymentDay) : null), [ledger, paymentDay]);
  const sessionStatus = ledger?.sessions.get(paymentDay) ?? null;
  const run = async (kind: 'report' | 'daily', action: () => Promise<{ filename: string; csv: string }>) => { setExporting(kind); setError(''); try { const result = await action(); download(result.filename, result.csv); } catch (failure) { setError(errorMessage(failure, text('無法匯出 CSV。', 'Unable to export CSV.'))); } finally { setExporting(null); } };
  const exportReport = () => { if (gateway) void run('report', () => gateway.exportCsv({ propertyId: session.propertyId, operationId: crypto.randomUUID(), ...range })); };
  const exportDaily = () => { const call = gateway?.exportDailySummaryCsv; if (call) void run('daily', () => call({ propertyId: session.propertyId, operationId: crypto.randomUUID(), dateFrom: paymentDay, dateTo: paymentDay })); };
  const planRows = report ? Object.entries(report.planCounts).map(([plan, count]) => ({ key: plan, label: plan, value: count })) : [];
  const rateRows = report ? ([['非假日', text('非假日', 'Weekday')], ['假日', text('假日', 'Holiday')]] as const).map(([key, label]) => ({ key, label, value: report.rateRevenueNts[key] })) : [];
  const paymentTypeLabel = { cash: text('現金', 'Cash'), transfer: text('轉帳', 'Transfer'), card: text('刷卡', 'Card'), other: text('其他', 'Other') } as const;
  const quickRanges = [
    [text('今日', 'Today'), () => ({ dateFrom: taipeiDay(), dateTo: taipeiDay() })],
    ['7D', () => lastDays(6)],
    [text('本月', 'This month'), initialRange],
    ['30D', () => lastDays(29)],
    [text('全部', 'All'), () => lastDays(3_650)],
  ] as const;
  return <div className="reports-page">
    <SectionCard actions={<Button disabled={!report || !gateway} loading={exporting === 'report'} onClick={exportReport} size="sm" variant="outline">{text('匯出 CSV', 'Export CSV')}</Button>} hint={text('即時營運統計', 'Live operations')} title={text('統計報表', 'Reports')}>
      <div className="report-filters"><Field label={text('開始日期', 'From')}><input max={range.dateTo} onChange={(event) => setRange((current) => ({ ...current, dateFrom: event.target.value }))} type="date" value={range.dateFrom} /></Field><Field label={text('結束日期', 'To')}><input min={range.dateFrom} onChange={(event) => setRange((current) => ({ ...current, dateTo: event.target.value }))} type="date" value={range.dateTo} /></Field><div className="report-quick-actions">{quickRanges.map(([label, next]) => <Button key={label} onClick={() => setRange(next())} size="sm" variant="ghost">{label}</Button>)}</div></div>
      {error ? <Notice tone="danger" title={text('報表載入失敗', 'Report loading failed')}>{error}</Notice> : null}
      {!gateway ? <Notice tone="warning" title={text('尚未連接 Firebase 報表資料。', 'Firebase reports are not connected.')} /> : null}
      {gateway && !report && !error ? <div className="empty-card">{text('正在載入即時報表…', 'Loading live reports…')}</div> : null}
      {report ? <>
        <p className="report-period">{`${report.dateFrom} ~ ${report.dateTo}（${report.days} ${text('天', 'days')}）`}</p>
        <div className="report-kpis">
          <Metric label={text('區間營收', 'Period revenue')} value={money(report.rangeRevenueNts)} detail={report.liveRevenueNts > 0 ? text(`在住未結 +${money(report.liveRevenueNts)}`, `+${money(report.liveRevenueNts)} in-house`) : text('已退房 + 月租認列', 'Completed stays + monthly rent')} />
          <Metric label={text('總訂單', 'Total orders')} value={String(report.totalOrders)} detail={report.cancelledOrders > 0 ? text(`取消 ${report.cancelledOrders} 筆`, `${report.cancelledOrders} cancelled`) : undefined} />
          <Metric label={text('目前住房率', 'Current occupancy')} value={`${report.occupancyNowPct}%`} detail={text(`${report.occupiedNow} / ${report.totalRooms} 間`, `${report.occupiedNow} / ${report.totalRooms} rooms`)} />
          <Metric label={text('區間住房率', 'Period occupancy')} value={`${report.rangeOccupancyPct}%`} detail={text(`${report.days} 天`, `${report.days} days`)} />
          <Metric label={text('取消／流失', 'Cancelled')} value={String(report.cancelledOrders)} />
          <Metric label={text('維修中', 'Under maintenance')} value={String(report.repairCount)} />
          <Metric label={text('平均住宿', 'Average stay')} value={`${report.avgStayHours}h`} />
          <Metric label={text('在住中', 'In-house')} value={String(report.activeStaysCount)} />
        </div>
        {isAdmin && report.totalCostNts !== null ? <section className="report-pnl"><div><small>{text('區間成本', 'Period costs')}</small><strong>{money(report.totalCostNts)}</strong></div><div><small>{text('淨損益', 'Net profit')}</small><strong className={report.netProfitNts !== null && report.netProfitNts < 0 ? 'negative' : ''}>{money(report.netProfitNts ?? 0)}</strong></div><div><small>{text('成本率', 'Cost ratio')}</small><strong>{report.costRatioPct ?? 0}%</strong></div>{Object.entries(report.costByCategoryNts ?? {}).map(([category, value]) => <span key={category}>{labelFor(COST_CATEGORY_LABELS, category, text)} · {money(value)}</span>)}<details className="report-cost-details"><summary>{text(`成本明細（${(report.costEntries ?? []).length} 筆）`, `Cost entries (${(report.costEntries ?? []).length})`)}</summary><div className="report-cost-list">{(report.costEntries ?? []).map((item, index) => <div key={`${item.costDate}-${index}`}><strong>{item.costDate}</strong><span>{labelFor(COST_CATEGORY_LABELS, item.category, text)}</span><span>{item.vendor ?? item.description ?? item.note ?? ''}</span><b>{money(item.amountNts)}</b></div>)}{(report.costEntries ?? []).length === 0 ? <div className="empty-card">{text('此區間沒有成本紀錄。', 'No costs in this period.')}</div> : null}</div></details></section> : null}
        <section className="report-section"><div className="report-section-heading"><h3>{text('每日營收與住房率', 'Daily revenue & occupancy')}</h3><small>{text('預約金額僅用於趨勢，區間營收以已退房與月租認列。', 'Bookings are trend-only; period revenue uses completed stays and recognised monthly rent.')}</small></div>
          <DailyChart daily={report.daily} occupancyLabel={text('住房率 (%)', 'Occupancy (%)')} revenueLabel={text('營收 (NT$)', 'Revenue (NT$)')} />
          <details className="report-daily-details"><summary>{text('每日明細', 'Daily detail')}</summary><div className="report-daily-list">{report.daily.map((item) => <div key={item.date}><strong>{item.date}</strong><span>{money(item.revenueNts)}</span><small>{item.occupancyPct}%</small></div>)}</div></details>
        </section>
        <div className="report-split">
          <section className="report-section"><div className="report-section-heading"><h3>{text('方案分佈', 'Plan split')}</h3><small>{text('筆數', 'Records')}</small></div><ShareBars format={(value) => String(value)} rows={planRows} /></section>
          <section className="report-section"><div className="report-section-heading"><h3>{text('平日／假日營收', 'Weekday / holiday revenue')}</h3></div><ShareBars format={money} rows={rateRows} /></section>
        </div>
      </> : null}
      {gateway?.subscribePaymentLedger ? <section className="report-section report-payment-summary">
        <div className="report-section-heading"><h3>{text(`付款摘要 — ${paymentDay}`, `Payment summary — ${paymentDay}`)}</h3><div className="report-quick-actions">{gateway.exportDailySummaryCsv ? <Button disabled={!paymentSummary} loading={exporting === 'daily'} onClick={exportDaily} size="sm" variant="outline">{text('日結 CSV', 'Daily CSV')}</Button> : null}{onOpenPayments ? <Button onClick={onOpenPayments} size="sm" variant="ghost">{text('前往付款管理', 'Open payments')}</Button> : null}</div></div>
        {ledgerError ? <Notice tone="danger" title={text('付款摘要載入失敗', 'Payment summary failed to load')}>{ledgerError}</Notice> : null}
        {paymentSummary ? <>
          <div className="payment-summary-grid"><div><small>{text('已收', 'Received')}</small><strong>{money(paymentSummary.receivedNts)}</strong></div><div><small>{text('退款', 'Refunds')}</small><strong>{money(paymentSummary.refundsNts)}</strong></div><div><small>{text('淨收入', 'Net')}</small><strong>{money(paymentSummary.netNts)}</strong></div><div><small>{text('待收款', 'Outstanding')}</small><strong>{money(paymentSummary.outstandingNts)}</strong></div></div>
          <div className="payment-type-summary">{(['cash', 'transfer', 'card', 'other'] as const).map((type) => <span key={type}>{paymentTypeLabel[type]}<b>{money(paymentSummary.byType[type])}</b></span>)}</div>
          <small className="report-session-status">{text('日結狀態：', 'Cashier session: ')}{sessionStatus === 'closed' ? text('已關閉', 'Closed') : sessionStatus === 'open' ? text('進行中', 'Open') : text('尚未日結', 'Not closed')}</small>
        </> : !ledgerError ? <div className="empty-card">{text('正在載入付款摘要…', 'Loading payment summary…')}</div> : null}
      </section> : null}
      {report ? <>
        <section className="report-section"><div className="report-section-heading"><h3>{text('房間營運', 'Room operations')}</h3><small>{text('依租用筆數排序', 'Sorted by rental count')}</small></div><div className="report-room-list">{report.roomRentals.map((item) => <article key={item.roomId}><div><strong>{item.roomId}</strong><small>{labelFor(ROOM_STATUS_LABELS, item.status, text)}{item.note ? ` · ${item.note}` : ''}</small></div><div><strong>{money(item.revenueNts)}</strong><small>{item.count} {text('筆', 'records')} · 12h {item.plans['12hrs'] ?? 0} / 24h {item.plans['24hrs'] ?? 0}{item.plans['月租'] ? ` / ${text('月租', 'Monthly')} ${item.plans['月租']}` : ''}</small></div></article>)}</div></section>
        <div className="report-split">
          <section className="report-section"><div className="report-section-heading"><h3>{text('預約狀態', 'Booking status')}</h3><small>{text('入住日在區間內', 'Check-in within range')}</small></div><CountTable counts={report.bookingStatusCounts} label={(code) => labelFor(BOOKING_STATUS_LABELS, code, text)} total={Math.max(1, report.totalOrders)} /></section>
          <section className="report-section"><div className="report-section-heading"><h3>{text('房態', 'Room status')}</h3><small>{text(`共 ${report.totalRooms} 間`, `${report.totalRooms} rooms`)}</small></div><CountTable counts={report.roomStatusCounts} label={(code) => labelFor(ROOM_STATUS_LABELS, code, text)} total={Math.max(1, report.totalRooms)} /></section>
        </div>
      </> : null}
    </SectionCard>
  </div>;
}
