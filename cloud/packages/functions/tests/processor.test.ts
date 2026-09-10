import { beforeEach, describe, expect, it } from 'vitest';

import { OPERATION_SCHEMA_VERSION } from '@bini/cloud-shared';

import { createHandlerRegistry, demoHandlers } from '../src/processor/handlers.js';
import { processOperation } from '../src/processor/core.js';
import { MemoryStore } from './support/memory-store.js';

const NOW = new Date('2026-09-09T00:00:00.000Z');

const request = (overrides: Record<string, unknown> = {}) => ({
  operationId: '8f1b0c9e-3a52-4a1d-9a4e-9d5c7b2f1a30',
  deviceId: 'device-front-desk-01',
  uid: 'user-abc',
  propertyId: 'property-main',
  operationType: 'demo.note.upsert',
  entityId: 'note-1',
  baseVersion: 0,
  payload: { text: 'hello' },
  schemaVersion: OPERATION_SCHEMA_VERSION,
  clientCreatedAt: '2026-09-09T01:02:03.000Z',
  ...overrides,
});

describe('operation processor core', () => {
  let store: MemoryStore;
  const deps = () => ({
    store,
    handlers: createHandlerRegistry(demoHandlers),
    now: () => NOW,
  });

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('accepts a valid demo operation and bumps the entity version', async () => {
    const result = await processOperation(request(), deps());

    expect(result.status).toBe('accepted');
    expect(result.uid).toBe('user-abc');
    expect(result.appliedVersion).toBe(1);
    expect(result.currentVersion).toBe(1);
    expect(result.code).toBeNull();
    expect(result.processedAt).toBe(NOW.toISOString());

    const entity = await store.loadEntity('demoNotes', 'property-main', 'note-1');
    expect(entity).not.toBeNull();
    expect(entity?.version).toBe(1);
    expect(entity?.data).toMatchObject({ text: 'hello' });
  });

  it('writes exactly one audit entry per applied operation', async () => {
    await processOperation(request(), deps());

    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]).toMatchObject({
      operationId: '8f1b0c9e-3a52-4a1d-9a4e-9d5c7b2f1a30',
      uid: 'user-abc',
      deviceId: 'device-front-desk-01',
      propertyId: 'property-main',
      operationType: 'demo.note.upsert',
      entityId: 'note-1',
      status: 'accepted',
      fromVersion: 0,
      toVersion: 1,
      processedAt: NOW.toISOString(),
    });
  });

  it('is idempotent: a retry of the same operationId does not apply twice', async () => {
    const first = await processOperation(request(), deps());
    const commitsAfterFirst = store.commitCount;

    const second = await processOperation(request(), deps());

    expect(second).toEqual(first);
    expect(store.commitCount).toBe(commitsAfterFirst);
    const entity = await store.loadEntity('demoNotes', 'property-main', 'note-1');
    expect(entity?.version).toBe(1);
    expect(store.audit).toHaveLength(1);
  });

  it('replays the stored result even when the entity has moved on', async () => {
    const first = await processOperation(request(), deps());
    await processOperation(
      request({
        operationId: '2c4d6e80-1111-4222-8333-444455556666',
        baseVersion: 1,
        payload: { text: 'second' },
      }),
      deps(),
    );

    const replay = await processOperation(request(), deps());

    expect(replay).toEqual(first);
    const entity = await store.loadEntity('demoNotes', 'property-main', 'note-1');
    expect(entity?.version).toBe(2);
    expect(entity?.data).toMatchObject({ text: 'second' });
  });

  it('reports a conflict when baseVersion is stale and writes nothing', async () => {
    await processOperation(request(), deps());

    const stale = await processOperation(
      request({
        operationId: '11111111-2222-4333-8444-555566667777',
        baseVersion: 0,
        payload: { text: 'stale' },
      }),
      deps(),
    );

    expect(stale.status).toBe('conflict');
    expect(stale.code).toBe('version_conflict');
    expect(stale.appliedVersion).toBeNull();
    expect(stale.currentVersion).toBe(1);

    const entity = await store.loadEntity('demoNotes', 'property-main', 'note-1');
    expect(entity?.version).toBe(1);
    expect(entity?.data).toMatchObject({ text: 'hello' });
  });

  it('records the conflict result so the retry is not reprocessed', async () => {
    await processOperation(request(), deps());
    const conflictOp = request({
      operationId: '11111111-2222-4333-8444-555566667777',
      baseVersion: 0,
      payload: { text: 'stale' },
    });

    const first = await processOperation(conflictOp, deps());
    const commits = store.commitCount;
    const second = await processOperation(conflictOp, deps());

    expect(second).toEqual(first);
    expect(store.commitCount).toBe(commits);
  });

  it('rejects a request that fails contract validation', async () => {
    const result = await processOperation(request({ baseVersion: -1 }), deps());

    expect(result.status).toBe('rejected');
    expect(result.code).toBe('validation_failed');
    expect(result.message).toBeTruthy();
    expect(store.entities.size).toBe(0);
    expect(store.commitCount).toBe(1);
  });

  it('rejects a request carrying a server-only result field', async () => {
    const result = await processOperation(request({ status: 'accepted' }), deps());

    expect(result.status).toBe('rejected');
    expect(result.code).toBe('validation_failed');
    expect(store.entities.size).toBe(0);
  });

  it('cannot persist a rejection when the operationId itself is unusable', async () => {
    const result = await processOperation(request({ operationId: 42 }), deps());

    expect(result.status).toBe('rejected');
    expect(result.code).toBe('validation_failed');
    expect(store.commitCount).toBe(0);
  });

  it('rejects an unregistered operationType', async () => {
    const result = await processOperation(request({ operationType: 'booking.create' }), deps());

    expect(result.status).toBe('rejected');
    expect(result.code).toBe('unsupported_operation');
    expect(store.entities.size).toBe(0);
  });

  it('rejects a payload the handler refuses', async () => {
    const result = await processOperation(request({ payload: { text: '' } }), deps());

    expect(result.status).toBe('rejected');
    expect(result.code).toBe('invalid_payload');
    expect(store.entities.size).toBe(0);
  });

  it('rejects a request whose uid does not match the authenticated caller', async () => {
    const result = await processOperation(request(), {
      ...deps(),
      authenticatedUid: 'someone-else',
    });

    expect(result.status).toBe('rejected');
    expect(result.code).toBe('unauthorized');
    expect(store.entities.size).toBe(0);
  });

  it('accepts when the authenticated caller matches', async () => {
    const result = await processOperation(request(), { ...deps(), authenticatedUid: 'user-abc' });

    expect(result.status).toBe('accepted');
  });

  it('keeps entities of different properties isolated', async () => {
    await processOperation(request(), deps());
    const other = await processOperation(
      request({
        operationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        propertyId: 'property-second',
        baseVersion: 0,
        payload: { text: 'other property' },
      }),
      deps(),
    );

    expect(other.status).toBe('accepted');
    expect(other.appliedVersion).toBe(1);
    expect((await store.loadEntity('demoNotes', 'property-main', 'note-1'))?.data).toMatchObject({
      text: 'hello',
    });
  });

  it('never emits a result status outside the contract', async () => {
    const accepted = await processOperation(request(), deps());
    const unsupported = await processOperation(request({ operationType: 'nope.nope' }), deps());

    for (const result of [accepted, unsupported]) {
      expect(['pending', 'accepted', 'rejected', 'conflict']).toContain(result.status);
    }
  });
});
