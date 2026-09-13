import {
  buildPaymentListItems,
  buildReportProjection,
  paymentDailySummaryExportInputSchema,
  paymentDailySummaryExportResultSchema,
  reportExportInputSchema,
  reportExportResultSchema,
  type CashierSessionStatus,
  type PaymentDailySummaryExportInput,
  type PaymentDailySummaryExportResult,
  type PaymentListItem,
  type ReportExportInput,
  type ReportExportResult,
  type ReportProjection,
} from '@bini/cloud-shared';
import { collection, onSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface ReportPaymentLedger { payments: PaymentListItem[]; sessions: ReadonlyMap<string, CashierSessionStatus>; }

export interface ReportGateway {
  subscribe(propertyId: string, range: { dateFrom: string; dateTo: string; includeCosts: boolean }, onValue: (value: ReportProjection) => void, onError: (error: Error) => void): Unsubscribe;
  exportCsv(input: ReportExportInput): Promise<ReportExportResult>;
  /** Live payments and cashier sessions for the v3 "payment summary" card. */
  subscribePaymentLedger?(propertyId: string, onValue: (value: ReportPaymentLedger) => void, onError: (error: Error) => void): Unsubscribe;
  exportDailySummaryCsv?(input: PaymentDailySummaryExportInput): Promise<PaymentDailySummaryExportResult>;
}

type Documents = Array<{ id: string; data: unknown }>;

/** Waits for every named collection, then rebuilds; any listener or parse failure stops emission for this subscription. */
function subscribeCollections(database: Firestore, propertyId: string, names: readonly string[], build: (source: Record<string, Documents>) => void, onError: (error: Error) => void, fallbackMessage: string): Unsubscribe {
  const source: Record<string, Documents | undefined> = {};
  let failed = false;
  const emit = () => {
    if (failed || names.some((name) => !source[name])) return;
    try { build(source as Record<string, Documents>); } catch (error) { failed = true; onError(error instanceof Error ? error : new Error(fallbackMessage)); }
  };
  const stops = names.map((name) => onSnapshot(collection(database, `properties/${propertyId}/${name}`), (snapshot) => { source[name] = snapshot.docs.map((document) => ({ id: document.id, data: document.data() })); emit(); }, (error) => { failed = true; onError(error); }));
  return () => stops.forEach((stop) => stop());
}

export function createReportGateway(database: Firestore, functions: Functions): ReportGateway {
  return {
    subscribe(propertyId, range, onValue, onError) {
      const names = ['rooms', 'bookings', 'stays', 'stayLogs', 'monthlyRentals', 'holidays', ...(range.includeCosts ? ['costEntries'] : [])];
      return subscribeCollections(database, propertyId, names, (source) => onValue(buildReportProjection({
        rooms: source.rooms!, bookings: source.bookings!, stays: source.stays!, stayLogs: source.stayLogs!, monthlyRentals: source.monthlyRentals!, holidays: source.holidays!,
        ...(range.includeCosts ? { costEntries: source.costEntries! } : {}),
      }, range)), onError, '報表資料格式不正確。');
    },
    async exportCsv(input) {
      const call = httpsCallable<ReportExportInput, unknown>(functions, 'reportExportCsv');
      return reportExportResultSchema.parse((await call(reportExportInputSchema.parse(input))).data);
    },
    subscribePaymentLedger(propertyId, onValue, onError) {
      return subscribeCollections(database, propertyId, ['payments', 'cashierSessions'], (source) => {
        const sessions = new Map<string, CashierSessionStatus>();
        for (const document of source.cashierSessions!) {
          const status = (document.data as { status?: unknown }).status;
          if (status !== 'open' && status !== 'closed') throw new Error(`cashierSessions/${document.id} 狀態不正確。`);
          sessions.set(document.id, status);
        }
        onValue({ payments: buildPaymentListItems(source.payments!), sessions });
      }, onError, '付款資料格式不正確。');
    },
    async exportDailySummaryCsv(input) {
      const call = httpsCallable<PaymentDailySummaryExportInput, unknown>(functions, 'paymentDailySummaryExportCsv');
      return paymentDailySummaryExportResultSchema.parse((await call(paymentDailySummaryExportInputSchema.parse(input))).data);
    },
  };
}
