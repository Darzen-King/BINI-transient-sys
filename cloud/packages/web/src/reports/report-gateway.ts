import { buildReportProjection, reportExportInputSchema, reportExportResultSchema, type ReportExportInput, type ReportExportResult, type ReportProjection } from '@bini/cloud-shared';
import { collection, onSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface ReportGateway {
  subscribe(propertyId: string, range: { dateFrom: string; dateTo: string; includeCosts: boolean }, onValue: (value: ReportProjection) => void, onError: (error: Error) => void): Unsubscribe;
  exportCsv(input: ReportExportInput): Promise<ReportExportResult>;
}

export function createReportGateway(database: Firestore, functions: Functions): ReportGateway {
  return {
    subscribe(propertyId, range, onValue, onError) {
      const source: Record<string, Array<{ id: string; data: unknown }> | undefined> = {};
      const names: string[] = range.includeCosts ? ['rooms', 'bookings', 'stays', 'stayLogs', 'monthlyRentals', 'costEntries'] : ['rooms', 'bookings', 'stays', 'stayLogs', 'monthlyRentals'];
      let failed = false;
      const emit = () => {
        if (failed || names.some((name) => !source[name])) return;
        try {
          onValue(buildReportProjection({ rooms: source.rooms!, bookings: source.bookings!, stays: source.stays!, stayLogs: source.stayLogs!, monthlyRentals: source.monthlyRentals!, ...(range.includeCosts ? { costEntries: source.costEntries! } : {}) }, range));
        } catch (error) { failed = true; onError(error instanceof Error ? error : new Error('報表資料格式不正確。')); }
      };
      const stops = names.map((name) => onSnapshot(collection(database, `properties/${propertyId}/${name}`), (snapshot) => { source[name] = snapshot.docs.map((document) => ({ id: document.id, data: document.data() })); emit(); }, (error) => { failed = true; onError(error); }));
      return () => stops.forEach((stop) => stop());
    },
    async exportCsv(input) {
      const call = httpsCallable<ReportExportInput, unknown>(functions, 'reportExportCsv');
      return reportExportResultSchema.parse((await call(reportExportInputSchema.parse(input))).data);
    },
  };
}
