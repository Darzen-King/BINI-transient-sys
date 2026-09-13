import { useEffect, useMemo, useState } from 'react';
import type { ReportProjection } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import { Button, Field, Notice, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { ReportGateway } from './report-gateway.js';

const taipeiDay = () => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; };
const initialRange = () => { const to = taipeiDay(); return { dateFrom: `${to.slice(0, 8)}01`, dateTo: to }; };
const money = (value: number) => `NT$ ${value.toLocaleString()}`;
const errorMessage = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;

function download(filename: string, csv: string) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div><small>{label}</small><strong>{value}</strong>{detail ? <span>{detail}</span> : null}</div>; }

export function ReportsPage({ session, gateway }: { session: StaffSession; gateway: ReportGateway | undefined }) {
  const { text } = useLocale(); const isAdmin = session.role === 'admin'; const [range, setRange] = useState(initialRange); const [report, setReport] = useState<ReportProjection | null>(null); const [error, setError] = useState(''); const [exporting, setExporting] = useState(false);
  useEffect(() => gateway?.subscribe(session.propertyId, { ...range, includeCosts: isAdmin }, (next) => { setReport(next); setError(''); }, (failure) => { setReport(null); setError(errorMessage(failure, text('無法載入統計報表。', 'Unable to load reports.'))); }), [gateway, isAdmin, range, session.propertyId, text]);
  const roomRows = useMemo(() => report?.roomRentals ?? [], [report]);
  const exportCsv = async () => { if (!gateway) return; setExporting(true); setError(''); try { const result = await gateway.exportCsv({ propertyId: session.propertyId, operationId: crypto.randomUUID(), ...range }); download(result.filename, result.csv); } catch (failure) { setError(errorMessage(failure, text('無法匯出 CSV。', 'Unable to export CSV.'))); } finally { setExporting(false); } };
  return <div className="reports-page">
    <SectionCard actions={<Button disabled={!report || !gateway} loading={exporting} onClick={() => void exportCsv()} size="sm" variant="outline">{text('匯出 CSV', 'Export CSV')}</Button>} hint={text('即時營運統計', 'Live operations')} title={text('統計報表', 'Reports')}>
      <div className="report-filters"><Field label={text('開始日期', 'From')}><input max={range.dateTo} onChange={(event) => setRange((current) => ({ ...current, dateFrom: event.target.value }))} type="date" value={range.dateFrom} /></Field><Field label={text('結束日期', 'To')}><input min={range.dateFrom} onChange={(event) => setRange((current) => ({ ...current, dateTo: event.target.value }))} type="date" value={range.dateTo} /></Field><div className="report-quick-actions"><Button onClick={() => setRange(initialRange)} size="sm" variant="ghost">{text('本月', 'This month')}</Button><Button onClick={() => { const today = taipeiDay(); setRange({ dateFrom: today, dateTo: today }); }} size="sm" variant="ghost">{text('今日', 'Today')}</Button></div></div>
      {error ? <Notice tone="danger" title={text('報表載入失敗', 'Report loading failed')}>{error}</Notice> : null}
      {!gateway ? <Notice tone="warning" title={text('尚未連接 Firebase 報表資料。', 'Firebase reports are not connected.')} /> : null}
      {gateway && !report && !error ? <div className="empty-card">{text('正在載入即時報表…', 'Loading live reports…')}</div> : null}
      {report ? <><div className="report-kpis"><Metric label={text('區間營收', 'Period revenue')} value={money(report.rangeRevenueNts)} detail={text(`已退房 + 月租認列`, 'Completed stays + monthly rent')} /><Metric label={text('總訂單', 'Total orders')} value={String(report.totalOrders)} detail={text(`取消 ${report.cancelledOrders} 筆`, `${report.cancelledOrders} cancelled`)} /><Metric label={text('目前住房率', 'Current occupancy')} value={`${report.occupancyNowPct}%`} detail={text(`${report.occupiedNow} / ${report.totalRooms} 間`, `${report.occupiedNow} / ${report.totalRooms} rooms`)} /><Metric label={text('區間住房率', 'Period occupancy')} value={`${report.rangeOccupancyPct}%`} detail={text(`平均 ${report.avgStayHours} 小時`, `${report.avgStayHours}h average stay`)} /><Metric label={text('維修中', 'Under maintenance')} value={String(report.repairCount)} detail={text(`目前入住 ${report.activeStaysCount} 間`, `${report.activeStaysCount} active stays`)} /></div>
        {isAdmin && report.totalCostNts !== null ? <section className="report-pnl"><div><small>{text('區間成本', 'Period costs')}</small><strong>{money(report.totalCostNts)}</strong></div><div><small>{text('淨損益', 'Net profit')}</small><strong className={report.netProfitNts !== null && report.netProfitNts < 0 ? 'negative' : ''}>{money(report.netProfitNts ?? 0)}</strong></div><div><small>{text('成本率', 'Cost ratio')}</small><strong>{report.costRatioPct ?? 0}%</strong></div>{Object.entries(report.costByCategoryNts ?? {}).map(([category, value]) => <span key={category}>{category} · {money(value)}</span>)}</section> : null}
        <section className="report-section"><div className="report-section-heading"><h3>{text('每日營收', 'Daily revenue')}</h3><small>{text('預約金額僅用於趨勢，區間營收以已退房與月租認列。', 'Bookings are trend-only; period revenue uses completed stays and recognised monthly rent.')}</small></div><div className="report-daily-list">{report.daily.map((item) => <div key={item.date}><strong>{item.date}</strong><span>{money(item.revenueNts)}</span><small>{item.occupancyPct}%</small></div>)}</div></section>
        <section className="report-section"><div className="report-section-heading"><h3>{text('房間營運', 'Room operations')}</h3><small>{text('依租用筆數排序', 'Sorted by rental count')}</small></div><div className="report-room-list">{roomRows.map((item) => <article key={item.roomId}><div><strong>{item.roomId}</strong><small>{item.status}{item.note ? ` · ${item.note}` : ''}</small></div><div><strong>{money(item.revenueNts)}</strong><small>{item.count} {text('筆', 'records')} · 12h {item.plans['12hrs'] ?? 0} / 24h {item.plans['24hrs'] ?? 0}</small></div></article>)}</div></section>
      </> : null}
    </SectionCard>
  </div>;
}
