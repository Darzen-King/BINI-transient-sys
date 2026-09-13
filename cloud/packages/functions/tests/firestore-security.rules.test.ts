import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const rulesPath = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));

const PROPERTY = 'property-main';
const OTHER_PROPERTY = 'property-second';
const OP_ID = '8f1b0c9e-3a52-4a1d-9a4e-9d5c7b2f1a30';
const MFA_CLAIMS = {
  email_verified: true,
  firebase: {
    sign_in_provider: 'password',
    sign_in_second_factor: 'totp',
    second_factor_identifier: 'primary-authenticator',
  },
};

let env: RulesTestEnvironment;

const validRequest = (overrides: Record<string, unknown> = {}) => ({
  operationId: OP_ID,
  deviceId: 'device-01',
  uid: 'staff-main',
  propertyId: PROPERTY,
  operationType: 'demo.note.upsert',
  entityId: 'note-1',
  baseVersion: 0,
  payload: { text: 'hello' },
  schemaVersion: 1,
  clientCreatedAt: '2026-09-09T01:02:03.000Z',
  ...overrides,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bini-v4',
    firestore: { rules: readFileSync(rulesPath, 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed authoritative data the way Admin SDK would (rules bypassed).
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/staff-main'), {
      active: true,
      roles: { [PROPERTY]: 'staff' },
    });
    await setDoc(doc(db, 'users/staff-other'), {
      active: true,
      roles: { [OTHER_PROPERTY]: 'staff' },
    });
    await setDoc(doc(db, 'users/staff-disabled'), {
      active: false,
      roles: { [PROPERTY]: 'staff' },
    });
    await setDoc(doc(db, 'users/admin-main'), {
      active: true,
      roles: { [PROPERTY]: 'admin' },
    });
    await setDoc(doc(db, 'users/manager-main'), {
      active: true,
      roles: { [PROPERTY]: 'manager' },
    });
    await setDoc(doc(db, `properties/${PROPERTY}`), { name: 'Main' });
    await setDoc(doc(db, `properties/${PROPERTY}/bookings/b1`), { version: 1, room: '202' });
    await setDoc(doc(db, `properties/${PROPERTY}/stayLogs/sl1`), { roomId: '202' });
    await setDoc(doc(db, `properties/${PROPERTY}/costEntries/cost-1`), { amountNts: 100 });
    await setDoc(doc(db, `properties/${PROPERTY}/cashierSessions/2026-09-13`), { status: 'closed', sessionDate: '2026-09-13' });
    await setDoc(doc(db, `properties/${PROPERTY}/maintenanceSchedules/m1`), { roomId: '202', status: 'scheduled' });
    await setDoc(doc(db, `properties/${PROPERTY}/monthlyRentals/mr1`), { roomId: '206', status: 'active' });
    await setDoc(doc(db, `properties/${PROPERTY}/holidays/2026-10-10`), { date: '2026-10-10', year: 2026, holiday: true });
    await setDoc(doc(db, `properties/${PROPERTY}/auditLogs/a1`), { operationId: OP_ID });
    await setDoc(doc(db, 'migrationImports/batch-1'), { status: 'complete', propertyId: PROPERTY });
    await setDoc(doc(db, `operationResults/${OP_ID}`), {
      uid: 'staff-main',
      propertyId: PROPERTY,
      status: 'accepted',
    });
    await setDoc(doc(db, 'operationRequests/disabled-request'), {
      ...validRequest({ operationId: 'disabled-request', uid: 'staff-disabled' }),
    });
    await setDoc(doc(db, 'operationResults/disabled-result'), {
      uid: 'staff-disabled',
      propertyId: PROPERTY,
      status: 'accepted',
    });
  });
});

const asStaff = () => env.authenticatedContext('staff-main', MFA_CLAIMS).firestore();
const asOtherStaff = () => env.authenticatedContext('staff-other', MFA_CLAIMS).firestore();
const asDisabled = () => env.authenticatedContext('staff-disabled', MFA_CLAIMS).firestore();
const asAdmin = () => env.authenticatedContext('admin-main', MFA_CLAIMS).firestore();
const asManager = () => env.authenticatedContext('manager-main', MFA_CLAIMS).firestore();
const asSingleFactorStaff = () => env.authenticatedContext('staff-main', {
  email_verified: true,
  firebase: { sign_in_provider: 'password' },
}).firestore();
const asUnverifiedMfaStaff = () => env.authenticatedContext('staff-main', {
  ...MFA_CLAIMS,
  email_verified: false,
}).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

describe('unauthenticated access', () => {
  it('cannot read authoritative data', async () => {
    await assertFails(getDoc(doc(asAnon(), `properties/${PROPERTY}/bookings/b1`)));
  });

  it('cannot create an operation request', async () => {
    await assertFails(setDoc(doc(asAnon(), `operationRequests/${OP_ID}`), validRequest()));
  });

  it('cannot read a property document', async () => {
    await assertFails(getDoc(doc(asAnon(), `properties/${PROPERTY}`)));
  });
});

describe('authorised reads', () => {
  it('an active member reads bookings of their own property', async () => {
    await assertSucceeds(getDoc(doc(asStaff(), `properties/${PROPERTY}/bookings/b1`)));
  });

  it('an active member reads maintenance schedules used by the room overview', async () => {
    await assertSucceeds(getDoc(doc(asStaff(), `properties/${PROPERTY}/maintenanceSchedules/m1`)));
  });

  it('an active member reads monthly rentals used by room management', async () => {
    await assertSucceeds(getDoc(doc(asStaff(), `properties/${PROPERTY}/monthlyRentals/mr1`)));
    await assertFails(getDoc(doc(asOtherStaff(), `properties/${PROPERTY}/monthlyRentals/mr1`)));
  });

  it('a member of another property cannot read them', async () => {
    await assertFails(getDoc(doc(asOtherStaff(), `properties/${PROPERTY}/bookings/b1`)));
  });

  it('a deactivated member cannot read them', async () => {
    await assertFails(getDoc(doc(asDisabled(), `properties/${PROPERTY}/bookings/b1`)));
  });

  it('a single-factor member cannot read PMS data', async () => {
    await assertFails(getDoc(doc(asSingleFactorStaff(), `properties/${PROPERTY}/bookings/b1`)));
  });

  it('an MFA member with an unverified email cannot read PMS data', async () => {
    await assertFails(getDoc(doc(asUnverifiedMfaStaff(), `properties/${PROPERTY}/bookings/b1`)));
  });

  it('a member reads their own user document', async () => {
    await assertSucceeds(getDoc(doc(asStaff(), 'users/staff-main')));
  });

  it('a member cannot read someone else user document', async () => {
    await assertFails(getDoc(doc(asStaff(), 'users/staff-other')));
  });

  it('only a manager or admin reads the audit log', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), `properties/${PROPERTY}/auditLogs/a1`)));
    await assertSucceeds(getDoc(doc(asManager(), `properties/${PROPERTY}/auditLogs/a1`)));
    await assertFails(getDoc(doc(asStaff(), `properties/${PROPERTY}/auditLogs/a1`)));
  });

  it('an active member reads holidays used by server-side pricing', async () => {
    await assertSucceeds(getDoc(doc(asStaff(), `properties/${PROPERTY}/holidays/2026-10-10`)));
    await assertFails(getDoc(doc(asOtherStaff(), `properties/${PROPERTY}/holidays/2026-10-10`)));
  });
});

describe('authoritative collections are server-only', () => {
  it('a member cannot write a booking directly', async () => {
    await assertFails(
      setDoc(doc(asStaff(), `properties/${PROPERTY}/bookings/b2`), { version: 1, room: '203' }),
    );
  });

  it('a member cannot update a booking directly', async () => {
    await assertFails(updateDoc(doc(asStaff(), `properties/${PROPERTY}/bookings/b1`), { room: '999' }));
  });

  it('an admin cannot write a booking directly either', async () => {
    await assertFails(
      setDoc(doc(asAdmin(), `properties/${PROPERTY}/bookings/b2`), { version: 1, room: '203' }),
    );
  });

  it('an admin cannot write a maintenance schedule directly either', async () => {
    await assertFails(
      setDoc(doc(asAdmin(), `properties/${PROPERTY}/maintenanceSchedules/m2`), { roomId: '203' }),
    );
  });

  it('a manager-capable member reads completed stays but not administrator-only costs', async () => {
    await assertSucceeds(getDoc(doc(asStaff(), `properties/${PROPERTY}/stayLogs/sl1`)));
    await assertFails(getDoc(doc(asStaff(), `properties/${PROPERTY}/costEntries/cost-1`)));
    await assertSucceeds(getDoc(doc(asAdmin(), `properties/${PROPERTY}/costEntries/cost-1`)));
  });

  it('a property member reads cashier session status for the report, but nobody writes it directly', async () => {
    await assertSucceeds(getDoc(doc(asStaff(), `properties/${PROPERTY}/cashierSessions/2026-09-13`)));
    await assertFails(setDoc(doc(asManager(), `properties/${PROPERTY}/cashierSessions/2026-09-14`), { status: 'closed' }));
  });

  it('an admin cannot write a cost record directly either', async () => {
    await assertFails(
      setDoc(doc(asAdmin(), `properties/${PROPERTY}/costEntries/cost-1`), { amountNts: 100 }),
    );
  });

  it('a member cannot write a monthly rental directly', async () => {
    await assertFails(setDoc(doc(asStaff(), `properties/${PROPERTY}/monthlyRentals/mr2`), { roomId: '205', status: 'active' }));
  });

  it('even a manager cannot write a holiday directly', async () => {
    await assertFails(setDoc(doc(asManager(), `properties/${PROPERTY}/holidays/2026-10-10`), { holiday: false }));
  });

  it('nobody can write the audit log', async () => {
    await assertFails(setDoc(doc(asAdmin(), `properties/${PROPERTY}/auditLogs/a2`), { x: 1 }));
  });

  it('nobody can write their own user document', async () => {
    await assertFails(updateDoc(doc(asStaff(), 'users/staff-main'), { active: true }));
  });

  it('nobody can write an operation result', async () => {
    await assertFails(
      setDoc(doc(asStaff(), `operationResults/${OP_ID}`), { status: 'accepted', uid: 'staff-main' }),
    );
  });
});

describe('operation requests', () => {
  it('an active member creates a request for their own property', async () => {
    await assertSucceeds(setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest()));
  });

  it('cannot create a request under a different uid', async () => {
    await assertFails(
      setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest({ uid: 'staff-other' })),
    );
  });

  it('cannot create a request for a property they do not belong to', async () => {
    await assertFails(
      setDoc(
        doc(asStaff(), `operationRequests/${OP_ID}`),
        validRequest({ propertyId: OTHER_PROPERTY }),
      ),
    );
  });

  it('a deactivated member cannot create a request', async () => {
    await assertFails(
      setDoc(doc(asDisabled(), `operationRequests/${OP_ID}`), validRequest({ uid: 'staff-disabled' })),
    );
  });

  it('cannot create a request whose document id differs from operationId', async () => {
    await assertFails(
      setDoc(doc(asStaff(), 'operationRequests/some-other-id'), validRequest()),
    );
  });

  it('rejects a malformed operationId even when it matches the document id', async () => {
    await assertFails(
      setDoc(
        doc(asStaff(), 'operationRequests/not-a-uuid'),
        validRequest({ operationId: 'not-a-uuid' }),
      ),
    );
  });

  it('cannot smuggle a server result field', async () => {
    for (const field of ['status', 'appliedVersion', 'currentVersion', 'code', 'message', 'processedAt']) {
      await assertFails(
        setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest({ [field]: 'accepted' })),
      );
    }
  });

  it('cannot add an unlisted field', async () => {
    await assertFails(
      setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest({ extra: true })),
    );
  });

  it('cannot omit a required field', async () => {
    const partial = validRequest();
    delete (partial as Record<string, unknown>).baseVersion;
    await assertFails(setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), partial));
  });

  it('rejects a wrongly typed field', async () => {
    await assertFails(
      setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest({ baseVersion: 'zero' })),
    );
    await assertFails(
      setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest({ payload: 'text' })),
    );
  });

  it('rejects a negative baseVersion', async () => {
    await assertFails(
      setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest({ baseVersion: -1 })),
    );
  });

  it('rejects an unsupported schemaVersion', async () => {
    await assertFails(
      setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest({ schemaVersion: 99 })),
    );
  });

  it('cannot update a request once created', async () => {
    await assertSucceeds(setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest()));
    await assertFails(updateDoc(doc(asStaff(), `operationRequests/${OP_ID}`), { entityId: 'note-2' }));
  });

  it('cannot delete a request', async () => {
    await assertSucceeds(setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest()));
    await assertFails(deleteDoc(doc(asStaff(), `operationRequests/${OP_ID}`)));
  });

  it('can read back its own request but not another user request', async () => {
    await assertSucceeds(setDoc(doc(asStaff(), `operationRequests/${OP_ID}`), validRequest()));
    await assertSucceeds(getDoc(doc(asStaff(), `operationRequests/${OP_ID}`)));
    await assertFails(getDoc(doc(asOtherStaff(), `operationRequests/${OP_ID}`)));
  });

  it('a deactivated member cannot read their historical request', async () => {
    await assertFails(getDoc(doc(asDisabled(), 'operationRequests/disabled-request')));
  });
});

describe('operation results', () => {
  it('the owning user reads their own result', async () => {
    await assertSucceeds(getDoc(doc(asStaff(), `operationResults/${OP_ID}`)));
  });

  it('another user cannot read it', async () => {
    await assertFails(getDoc(doc(asOtherStaff(), `operationResults/${OP_ID}`)));
  });

  it('a deactivated member cannot read their historical result', async () => {
    await assertFails(getDoc(doc(asDisabled(), 'operationResults/disabled-result')));
  });

  it('nobody can delete it', async () => {
    await assertFails(deleteDoc(doc(asStaff(), `operationResults/${OP_ID}`)));
  });
});

describe('default deny', () => {
  it('an undeclared collection is closed', async () => {
    await assertFails(getDoc(doc(asAdmin(), 'somethingElse/x')));
    await assertFails(setDoc(doc(asAdmin(), 'somethingElse/x'), { a: 1 }));
  });

  it('keeps migration staging server-only even for a property admin', async () => {
    await assertFails(getDoc(doc(asAdmin(), 'migrationImports/batch-1')));
    await assertFails(setDoc(doc(asAdmin(), 'migrationImports/batch-2'), { status: 'complete' }));
  });
});
