import { z } from 'zod';

const room = z.object({ roomId: z.string().trim().min(1).max(128), status: z.enum(['可入住', '待清潔', '清潔中', '使用中', '即將退房', '維修中', '月租套房']), guestName: z.string().trim().max(300).nullable().optional(), note: z.string().max(2_000).nullable().optional() }).passthrough();
export interface HousekeepingItem { roomId: string; status: '待清潔' | '清潔中'; guestName: string | null; note: string | null; }
export function buildHousekeepingItems(documents: readonly { id: string; data: unknown }[]): HousekeepingItem[] { return documents.map((document) => room.parse(document.data)).filter((value): value is z.infer<typeof room> & { status: '待清潔' | '清潔中' } => value.status === '待清潔' || value.status === '清潔中').map((value) => ({ roomId: value.roomId, status: value.status, guestName: value.guestName ?? null, note: value.note ?? null })).sort((left, right) => left.roomId.localeCompare(right.roomId, 'zh-Hant')); }
