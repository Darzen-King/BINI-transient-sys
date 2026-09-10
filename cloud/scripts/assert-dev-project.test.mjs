import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  EXPECTED_DEV_PROJECT_ID,
  assertDevProjectConfig,
} from './assert-dev-project.mjs';

async function fixture(contents) {
  const directory = await mkdtemp(join(tmpdir(), 'bini-firebase-guard-'));
  const file = join(directory, '.firebaserc');
  await writeFile(file, contents, 'utf8');
  return file;
}

test('accepts only the confirmed DEV project id', async () => {
  const file = await fixture(JSON.stringify({ projects: { dev: 'bini-transient-dev' } }));
  assert.equal(assertDevProjectConfig(file), EXPECTED_DEV_PROJECT_ID);
});

test('fails closed when .firebaserc is missing', () => {
  assert.throws(
    () => assertDevProjectConfig(join(tmpdir(), 'missing-bini-firebaserc')),
    /missing/i,
  );
});

test('rejects malformed JSON without leaking file contents', async () => {
  const file = await fixture('{"token":"DO_NOT_LEAK"');
  assert.throws(
    () => assertDevProjectConfig(file),
    (error) => error instanceof Error && /malformed/i.test(error.message) && !error.message.includes('DO_NOT_LEAK'),
  );
});

test('rejects the confirmed production project id', async () => {
  const file = await fixture(JSON.stringify({ projects: { dev: 'bini-transient' } }));
  assert.throws(() => assertDevProjectConfig(file), /production/i);
});

test('rejects a missing dev alias', async () => {
  const file = await fixture(JSON.stringify({ projects: {} }));
  assert.throws(() => assertDevProjectConfig(file), /dev alias/i);
});

test('rejects every unexpected project id without echoing it', async () => {
  const unexpectedId = 'attacker-controlled-project';
  const file = await fixture(JSON.stringify({ projects: { dev: unexpectedId } }));
  assert.throws(
    () => assertDevProjectConfig(file),
    (error) => error instanceof Error && /unexpected/i.test(error.message) && !error.message.includes(unexpectedId),
  );
});
