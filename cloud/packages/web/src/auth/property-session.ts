import { CLOUD_ROLES, type CloudRole } from '@bini/cloud-shared';
import { doc, getDoc, type Firestore } from 'firebase/firestore';

export interface PropertyMembership { propertyId: string; role: CloudRole; }

const STORAGE_KEY = 'bini.activePropertyId';

/** Every property the profile grants a valid role in; Rules and Functions authorise each one independently. */
export function listMemberships(roles: unknown): PropertyMembership[] {
  if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) return [];
  return Object.entries(roles as Record<string, unknown>)
    .filter((entry): entry is [string, CloudRole] => typeof entry[1] === 'string' && CLOUD_ROLES.includes(entry[1] as CloudRole) && Boolean(entry[0]) && !entry[0].includes('/'))
    .map(([propertyId, role]) => ({ propertyId, role }))
    .sort((left, right) => left.propertyId.localeCompare(right.propertyId));
}

/** Last chosen property if still granted, otherwise the deployment default, otherwise the first membership. */
export function choosePropertyId(memberships: readonly PropertyMembership[], preferred: string | null, fallback: string): string | null {
  const granted = (id: string | null) => Boolean(id && memberships.some((membership) => membership.propertyId === id));
  if (granted(preferred)) return preferred;
  if (granted(fallback)) return fallback;
  return memberships[0]?.propertyId ?? null;
}

export function readPreferredProperty(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function writePreferredProperty(propertyId: string): void {
  try { window.localStorage.setItem(STORAGE_KEY, propertyId); } catch { /* storage may be blocked; the choice then lasts for this session only */ }
}

export interface PropertyNameGateway { load(propertyIds: readonly string[]): Promise<Record<string, string>>; }

/** Members may `get` their property documents; migrated v3 properties keep the name under `legacyV3Import`. */
export function createPropertyNameGateway(database: Firestore): PropertyNameGateway {
  return {
    async load(propertyIds) {
      const entries = await Promise.all(propertyIds.map(async (propertyId) => {
        try {
          const data = (await getDoc(doc(database, 'properties', propertyId))).data() ?? {};
          const legacy = data.legacyV3Import as { name?: unknown } | undefined;
          const name = typeof data.name === 'string' && data.name.trim() ? data.name : typeof legacy?.name === 'string' ? legacy.name : propertyId;
          return [propertyId, name] as const;
        } catch {
          return [propertyId, propertyId] as const;
        }
      }));
      return Object.fromEntries(entries);
    },
  };
}
