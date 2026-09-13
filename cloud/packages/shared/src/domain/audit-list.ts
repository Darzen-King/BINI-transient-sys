import { z } from 'zod';

export interface AuditSourceDocument { id: string; data: unknown; }
export interface AuditListItem { auditId: string; createdAt: string; action: string; targetId: string | null; targetType: string | null; actor: string; description: string | null; before: unknown; after: unknown; details: unknown; }
export interface AuditQuery { action: string; targetId: string; keyword: string; page: number; pageSize?: number; }
export interface AuditListProjection { items: AuditListItem[]; total: number; page: number; pageSize: number; totalPages: number; actions: string[]; }

const dateTime = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid datetime');
const rawSchema = z.object({
  createdAt: dateTime,
  action: z.string().trim().min(1).max(128),
  targetId: z.string().trim().min(1).max(256).nullable().optional(),
  targetType: z.string().trim().min(1).max(128).nullable().optional(),
  actorUid: z.string().trim().min(1).max(256).optional(),
  actorLegacyId: z.string().trim().min(1).max(256).optional(),
  description: z.string().max(10_000).nullable().optional(),
  originalValue: z.unknown().optional(), newValue: z.unknown().optional(), details: z.unknown().optional(),
}).passthrough();

function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function includes(value: unknown, needle: string): boolean { if (!needle) return true; try { return JSON.stringify(value).toLocaleLowerCase().includes(needle.toLocaleLowerCase()); } catch { return false; } }

/** Normalises migrated v3 ActivityLog rows and v4 append-only audit events into one read-only list. */
export function buildAuditList(documents: readonly AuditSourceDocument[], query: AuditQuery): AuditListProjection {
  const pageSize = query.pageSize ?? 50;
  if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('audit pagination is invalid');
  const all = documents.map((document) => {
    const parsed = rawSchema.safeParse(document.data);
    if (!parsed.success) throw new Error(`auditLogs/${document.id} does not match the audit schema`);
    const value = parsed.data; const detail = record(value.details);
    return { auditId: document.id, createdAt: value.createdAt, action: value.action, targetId: value.targetId ?? null, targetType: value.targetType ?? null, actor: value.actorUid ?? value.actorLegacyId ?? '—', description: value.description ?? null, before: value.originalValue ?? detail?.before ?? null, after: value.newValue ?? detail?.after ?? null, details: value.details ?? null } satisfies AuditListItem;
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.auditId.localeCompare(left.auditId));
  const action = query.action.trim(); const targetId = query.targetId.trim().toLocaleLowerCase(); const keyword = query.keyword.trim().toLocaleLowerCase();
  const filtered = all.filter((item) => (!action || item.action === action) && (!targetId || item.targetId?.toLocaleLowerCase().includes(targetId)) && (!keyword || [item.action, item.targetId, item.targetType, item.actor, item.description, item.before, item.after, item.details].some((value) => includes(value, keyword))));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); const page = Math.min(query.page, totalPages); const start = (page - 1) * pageSize;
  return { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, totalPages, actions: [...new Set(all.map((item) => item.action))].sort() };
}
