/* global fetch */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { TARGETS, assertProdProjectConfig, parseTarget, readTargetEnvironment } from './deploy-target.mjs';

// `--target=prod` bootstraps the production project (also needs BINI_PROD_DEPLOY_CONFIRM); DEV is the default.
const TARGET = parseTarget();
const EXPECTED_PROJECT_ID = TARGETS[TARGET].projectId;
const LABEL = TARGETS[TARGET].label;
const EXPECTED_ADMIN_EMAIL = 'biniblooms250808@gmail.com';
const PROPERTY_ID = 'property-main';
const ALL_PAGES = [
  'rooms', 'gantt', 'payments', 'bookings', 'bookings_new', 'checkin',
  'extend', 'checkout', 'room_management', 'housekeeping', 'maintenance',
  'reports', 'audit', 'users', 'properties', 'costs', 'holidays',
];

function gcloudAccessToken() {
  const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'gcloud';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'gcloud.cmd auth print-access-token']
    : ['auth', 'print-access-token'];
  return execFileSync(executable, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

async function requestJson(url, token, body, extraHeaders = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': EXPECTED_PROJECT_ID,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const code = typeof data?.error?.status === 'string' ? data.error.status : 'REQUEST_FAILED';
    const message = typeof data?.error?.message === 'string' ? data.error.message : '';
    const error = new Error(code);
    error.remoteMessage = message;
    throw error;
  }
  return data;
}

async function findUser(projectId, token, email) {
  try {
    const data = await requestJson(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
      token,
      { email: [email] },
    );
    return data.users?.[0] ?? null;
  } catch (error) {
    if (error.remoteMessage?.includes('USER_NOT_FOUND')) return null;
    throw error;
  }
}

async function createUser(projectId, apiKey, token, email) {
  return requestJson(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts?key=${encodeURIComponent(apiKey)}`,
    token,
    {
      email,
      emailVerified: true,
      displayName: 'BINI Administrator',
      disabled: false,
    },
  );
}

const stringValue = (value) => ({ stringValue: value });
const booleanValue = (value) => ({ booleanValue: value });
const timestampValue = (value) => ({ timestampValue: value });
const mapValue = (fields) => ({ mapValue: { fields } });
const stringArrayValue = (values) => ({
  arrayValue: { values: values.map((value) => stringValue(value)) },
});

async function writeBootstrapDocuments(projectId, token, uid, email, isNewUser) {
  const databaseRoot = `projects/${projectId}/databases/(default)/documents`;
  const now = new Date().toISOString();
  const writes = [
    {
      update: {
        name: `${databaseRoot}/properties/${PROPERTY_ID}`,
        fields: {
          propertyId: stringValue(PROPERTY_ID),
          name: stringValue('BINI Blooms'),
          active: booleanValue(true),
          timezone: stringValue('Asia/Taipei'),
          currency: stringValue('TWD'),
          updatedAt: timestampValue(now),
        },
      },
      updateMask: { fieldPaths: ['propertyId', 'name', 'active', 'timezone', 'currency', 'updatedAt'] },
    },
    {
      update: {
        name: `${databaseRoot}/users/${uid}`,
        fields: {
          email: stringValue(email),
          displayName: stringValue('BINI Administrator'),
          active: booleanValue(true),
          roles: mapValue({ [PROPERTY_ID]: stringValue('admin') }),
          allowedPages: mapValue({ [PROPERTY_ID]: stringArrayValue(ALL_PAGES) }),
          mfaRequired: booleanValue(true),
          updatedAt: timestampValue(now),
        },
      },
      updateMask: { fieldPaths: ['email', 'displayName', 'active', 'roles', 'allowedPages', 'mfaRequired', 'updatedAt'] },
    },
  ];

  if (isNewUser) {
    writes.push({
      update: {
        name: `${databaseRoot}/properties/${PROPERTY_ID}/auditLogs/${randomUUID()}`,
        fields: {
          actorUid: stringValue(uid),
          action: stringValue('staff.bootstrap'),
          targetUid: stringValue(uid),
          details: mapValue({ email: stringValue(email), role: stringValue('admin') }),
          createdAt: timestampValue(now),
        },
      },
      currentDocument: { exists: false },
    });
  }

  await requestJson(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`,
    token,
    { writes },
  );
}

async function sendPasswordSetupEmail(apiKey, token, email) {
  await requestJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`,
    token,
    { requestType: 'PASSWORD_RESET', email },
    { 'X-Firebase-Locale': 'zh-TW' },
  );
}

async function main() {
  let step = 'validate';
  if (TARGET === 'prod') assertProdProjectConfig();
  const localEnvironment = readTargetEnvironment(TARGET);
  const projectId = process.env.BINI_BOOTSTRAP_PROJECT_ID ?? localEnvironment.VITE_FIREBASE_PROJECT_ID;
  const email = (process.env.BINI_BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const apiKey = localEnvironment.VITE_FIREBASE_API_KEY;

  if (projectId !== EXPECTED_PROJECT_ID) throw new Error(`Bootstrap is restricted to the confirmed ${LABEL} project.`);
  if (email !== EXPECTED_ADMIN_EMAIL) throw new Error('Bootstrap is restricted to the confirmed first admin email.');
  if (!apiKey || apiKey === 'REPLACE_ME') throw new Error(`${LABEL} Firebase Web API key is missing.`);

  try {
    step = 'authenticate';
    const token = gcloudAccessToken();
    step = 'lookup-user';
    let user = await findUser(projectId, token, email);
    const isNewUser = !user;
    if (!user) {
      step = 'create-user';
      user = await createUser(projectId, apiKey, token, email);
    }
    if (typeof user.localId !== 'string' || !user.localId) throw new Error('Identity Platform did not return a user id.');

    step = 'write-firestore';
    await writeBootstrapDocuments(projectId, token, user.localId, email, isNewUser);
    step = 'send-password-email';
    await sendPasswordSetupEmail(apiKey, token, email);

    console.log(`${LABEL} admin bootstrap complete (${isNewUser ? 'created' : 'reconciled'}); password setup email sent.`);
  } catch (error) {
    error.bootstrapStep = step;
    throw error;
  }
}

main().catch((error) => {
  const step = typeof error?.bootstrapStep === 'string' ? error.bootstrapStep : 'unknown';
  const message = error instanceof Error ? error.message : 'Admin bootstrap failed.';
  const remoteMessage = typeof error?.remoteMessage === 'string' ? ` (${error.remoteMessage})` : '';
  console.error(`Bootstrap failed at ${step}: ${message}${remoteMessage}`);
  process.exitCode = 1;
});
