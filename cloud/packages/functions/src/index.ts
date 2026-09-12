import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import type { OperationRequest } from '@bini/cloud-shared';

import { processOperation } from './processor/core.js';
import { FirestoreProcessorStore } from './processor/firestore-store.js';
import { createHandlerRegistry, demoHandlers } from './processor/handlers.js';

export {
  adminCreateStaff,
  adminListStaff,
  adminSetStaffPassword,
  adminUpdateStaff,
} from './admin/staff-admin.js';
export { adminStageV3Backup } from './migration/stage-v3-backup.js';
export { adminPrepareV3Backup } from './migration/prepare-v3-backup.js';
export { adminPromotePreparedV3Backup } from './migration/promote-v3-backup.js';
export { bookingCreate } from './bookings/create-booking.js';
export { bookingCancel } from './bookings/cancel-booking.js';

if (getApps().length === 0) initializeApp();

const db = getFirestore();
const store = new FirestoreProcessorStore(db);
const handlers = createHandlerRegistry(demoHandlers);

async function isAuthorised(request: OperationRequest): Promise<boolean> {
  const user = await db.doc(`users/${request.uid}`).get();
  if (!user.exists || user.data()?.active !== true) return false;
  const roles = user.data()?.roles;
  return typeof roles === 'object' && roles !== null && typeof roles[request.propertyId] === 'string';
}

export const processOperationRequest = onDocumentCreated(
  {
    document: 'operationRequests/{operationId}',
    region: 'asia-east1',
    retry: true,
    maxInstances: 10,
  },
  async (event) => {
    if (!event.data) return;
    await processOperation(event.data.data(), { store, handlers, authorize: isAuthorised });
  },
);
