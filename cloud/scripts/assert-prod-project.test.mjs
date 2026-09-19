import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assertProdProjectConfig } from './assert-prod-project.mjs';
import { parseTarget, readTargetEnvironment } from './deploy-target.mjs';

const confirmed = { BINI_PROD_DEPLOY_CONFIRM: 'bini-transient' };

async function fixture(contents) {
  const directory = await mkdtemp(join(tmpdir(), 'bini-prod-guard-'));
  const file = join(directory, '.firebaserc');
  await writeFile(file, contents, 'utf8');
  return file;
}

test('accepts the production alias only with an explicit confirmation', async () => {
  const file = await fixture(JSON.stringify({ projects: { dev: 'bini-transient-dev', prod: 'bini-transient' } }));
  assert.equal(assertProdProjectConfig(file, confirmed), 'bini-transient');
  assert.throws(() => assertProdProjectConfig(file, {}), /BINI_PROD_DEPLOY_CONFIRM/);
  assert.throws(() => assertProdProjectConfig(file, { BINI_PROD_DEPLOY_CONFIRM: 'yes' }), /BINI_PROD_DEPLOY_CONFIRM/);
});

test('rejects a prod alias pointing anywhere else', async () => {
  const file = await fixture(JSON.stringify({ projects: { prod: 'bini-transient-dev' } }));
  assert.throws(() => assertProdProjectConfig(file, confirmed), /prod alias/);
});

test('rejects a dev alias pointing at production', async () => {
  const file = await fixture(JSON.stringify({ projects: { dev: 'bini-transient', prod: 'bini-transient' } }));
  assert.throws(() => assertProdProjectConfig(file, confirmed), /dev alias/);
});

test('fails closed when .firebaserc is missing or malformed', async () => {
  assert.throws(() => assertProdProjectConfig(join(tmpdir(), 'missing-bini-prod-firebaserc'), confirmed), /missing or malformed/);
  const file = await fixture('{not json');
  assert.throws(() => assertProdProjectConfig(file, confirmed), /missing or malformed/);
});

test('targets default to DEV and reject unknown names', () => {
  assert.equal(parseTarget([]), 'dev');
  assert.equal(parseTarget(['--target=prod']), 'prod');
  assert.throws(() => parseTarget(['--target=staging']), /Unknown deploy target/);
});

test('the PROD environment layers .env.prod.local over .env.local', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bini-prod-env-'));
  await writeFile(join(directory, '.env.local'), 'VITE_FIREBASE_PROJECT_ID=bini-transient-dev\nVITE_USE_EMULATORS=0\n', 'utf8');
  await writeFile(join(directory, '.env.prod.local'), 'VITE_FIREBASE_PROJECT_ID=bini-transient\n', 'utf8');
  assert.deepEqual(readTargetEnvironment('prod', directory), { VITE_FIREBASE_PROJECT_ID: 'bini-transient', VITE_USE_EMULATORS: '0' });
  assert.equal(readTargetEnvironment('dev', directory).VITE_FIREBASE_PROJECT_ID, 'bini-transient-dev');
});
