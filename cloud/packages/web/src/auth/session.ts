import type { CloudPageId, CloudRole } from '@bini/cloud-shared';

export interface StaffSession {
  uid: string;
  email: string;
  displayName: string;
  propertyId: string;
  role: CloudRole;
  allowedPages: CloudPageId[];
}
