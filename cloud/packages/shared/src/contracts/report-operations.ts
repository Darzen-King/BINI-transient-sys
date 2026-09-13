import { z } from 'zod';

const propertyId = z.string().trim().min(1).max(128).regex(/^[^/]+$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const reportExportInputSchema = z.object({
  propertyId,
  operationId: z.string().uuid(),
  dateFrom: date,
  dateTo: date,
}).strict().refine((value) => value.dateFrom <= value.dateTo, 'date range is invalid');
export type ReportExportInput = z.infer<typeof reportExportInputSchema>;

export const reportExportResultSchema = z.object({
  filename: z.string().regex(/^bini_blooms_report_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/u),
  csv: z.string().min(1).max(5_000_000),
}).strict();
export type ReportExportResult = z.infer<typeof reportExportResultSchema>;

/** v3 `/export/daily_summary`: per-day payment totals for manager/admin reports. "All" spans ten years. */
export const paymentDailySummaryExportInputSchema = z.object({
  propertyId,
  operationId: z.string().uuid(),
  dateFrom: date,
  dateTo: date,
}).strict()
  .refine((value) => value.dateFrom <= value.dateTo, 'date range is invalid')
  .refine((value) => Date.parse(`${value.dateTo}T00:00:00Z`) - Date.parse(`${value.dateFrom}T00:00:00Z`) <= 3_700 * 86_400_000, 'date range is too long');
export type PaymentDailySummaryExportInput = z.infer<typeof paymentDailySummaryExportInputSchema>;

export const paymentDailySummaryExportResultSchema = z.object({
  filename: z.string().regex(/^daily_summary_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/u),
  csv: z.string().min(1).max(5_000_000),
}).strict();
export type PaymentDailySummaryExportResult = z.infer<typeof paymentDailySummaryExportResultSchema>;
