import { CLOUD_PAGE_IDS, CLOUD_ROLES, type CloudPageId, type CloudRole } from '@bini/cloud-shared';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function hasVerifiedMfaClaims(token: unknown): boolean {
  const claims = asRecord(token);
  if (!claims || claims.email_verified !== true) return false;
  const firebase = asRecord(claims.firebase);
  return typeof firebase?.sign_in_second_factor === 'string'
    && firebase.sign_in_second_factor.length > 0;
}

export function roleForProperty(profile: unknown, propertyId: string): CloudRole | null {
  const data = asRecord(profile);
  if (!data || data.active !== true) return null;
  const roles = asRecord(data.roles);
  const role = roles?.[propertyId];
  return typeof role === 'string' && CLOUD_ROLES.includes(role as CloudRole)
    ? role as CloudRole
    : null;
}

export function allowedPagesForProperty(profile: unknown, propertyId: string): CloudPageId[] {
  const data = asRecord(profile);
  if (!data || roleForProperty(data, propertyId) === null) return [];
  const pageMap = asRecord(data.allowedPages);
  const pages = pageMap?.[propertyId];
  if (!Array.isArray(pages)) return [];
  return pages.filter((page): page is CloudPageId => (
    typeof page === 'string' && CLOUD_PAGE_IDS.includes(page as CloudPageId)
  ));
}

export function hasPagePermission(profile: unknown, propertyId: string, pageId: CloudPageId): boolean {
  return allowedPagesForProperty(profile, propertyId).includes(pageId);
}
