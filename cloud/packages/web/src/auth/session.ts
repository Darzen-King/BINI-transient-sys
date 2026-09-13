import type { CloudPageId, CloudRole } from '@bini/cloud-shared';

import type { PropertyMembership } from './property-session.js';

export interface StaffSession {
  uid: string;
  email: string;
  displayName: string;
  propertyId: string;
  role: CloudRole;
  allowedPages: CloudPageId[];
  /** Properties this account may switch to; absent or single means no property switcher. */
  memberships?: readonly PropertyMembership[];
}
