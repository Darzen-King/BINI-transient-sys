import { z } from 'zod';

export interface HolidaySourceDocument { id: string; data: unknown; }
export interface HolidayListItem {
  date: string;
  year: number;
  description: string | null;
  holiday: boolean;
  manual: boolean;
  source: string | null;
  version: number;
}

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  year: z.number().int().min(2020).max(2100),
  description: z.string().max(500).nullable().optional(),
  holiday: z.boolean(),
  manual: z.boolean().optional(),
  source: z.string().max(64).nullable().optional(),
  version: z.number().int().min(0).optional(),
}).passthrough();

export function buildHolidayList(documents: readonly HolidaySourceDocument[]): HolidayListItem[] {
  const seen = new Set<string>();
  return documents.map((document) => {
    const parsed = schema.safeParse(document.data);
    if (!parsed.success || parsed.data.year !== Number(parsed.data.date.slice(0, 4))) throw new Error(`holidays/${document.id} 資料格式不正確。`);
    if (seen.has(parsed.data.date)) throw new Error(`holidays/${document.id} 假日日期重複。`);
    seen.add(parsed.data.date);
    return { date: parsed.data.date, year: parsed.data.year, description: parsed.data.description ?? null, holiday: parsed.data.holiday, manual: parsed.data.manual ?? false, source: parsed.data.source ?? null, version: parsed.data.version ?? 0 };
  }).sort((left, right) => left.date.localeCompare(right.date));
}
