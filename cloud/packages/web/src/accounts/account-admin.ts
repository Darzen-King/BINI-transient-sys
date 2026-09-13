import {
  staffDirectoryEntrySchema,
  type StaffCreateInput,
  type StaffDirectoryEntry,
  type StaffResetMfaInput,
  type StaffSetPasswordInput,
  type StaffUpdateInput,
} from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface AccountAdminGateway {
  list(propertyId: string): Promise<StaffDirectoryEntry[]>;
  create(input: StaffCreateInput): Promise<void>;
  update(input: StaffUpdateInput): Promise<void>;
  setPassword(input: StaffSetPasswordInput): Promise<void>;
  resetMfa?(input: StaffResetMfaInput): Promise<void>;
}

export function createAccountAdminGateway(functions: Functions): AccountAdminGateway {
  return {
    async list(propertyId) {
      const call = httpsCallable<{ propertyId: string }, { users: unknown }>(functions, 'adminListStaff');
      const result = await call({ propertyId });
      return staffDirectoryEntrySchema.array().parse(result.data.users);
    },
    async create(input) {
      const call = httpsCallable<StaffCreateInput, { uid: string }>(functions, 'adminCreateStaff');
      await call(input);
    },
    async update(input) {
      const call = httpsCallable<StaffUpdateInput, { ok: true }>(functions, 'adminUpdateStaff');
      await call(input);
    },
    async setPassword(input) {
      const call = httpsCallable<StaffSetPasswordInput, { ok: true }>(functions, 'adminSetStaffPassword');
      await call(input);
    },
    async resetMfa(input) {
      const call = httpsCallable<StaffResetMfaInput, { ok: true }>(functions, 'adminResetStaffMfa');
      await call(input);
    },
  };
}
