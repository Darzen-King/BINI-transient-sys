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
