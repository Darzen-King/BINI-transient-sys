import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEV_PROJECT_ID = 'bini-transient-dev';
export const PROD_PROJECT_ID = 'bini-transient';
/** A production deploy only runs when this variable names the production project. */
export const PROD_CONFIRM_VARIABLE = 'BINI_PROD_DEPLOY_CONFIRM';

const CLOUD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TARGETS = {
  dev: { projectId: DEV_PROJECT_ID, envFiles: ['.env.local'], label: 'DEV' },
  // Vite `--mode prod` layers .env.prod.local over .env.local; the scripts read them the same way.
  prod: { projectId: PROD_PROJECT_ID, envFiles: ['.env.local', '.env.prod.local'], label: 'PROD' },
};

export function parseTarget(argv = process.argv.slice(2)) {
  const flag = argv.find((value) => value.startsWith('--target='));
  const target = flag ? flag.slice('--target='.length) : 'dev';
  if (!Object.hasOwn(TARGETS, target)) throw new Error(`Unknown deploy target: ${target}.`);
  return target;
}

function parseEnvironmentFile(content) {
  return Object.fromEntries(content.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

export function readTargetEnvironment(target, root = CLOUD_ROOT) {
  const merged = {};
  for (const file of TARGETS[target].envFiles) {
    const path = resolve(root, file);
    if (!existsSync(path)) throw new Error(`${TARGETS[target].label} environment file is missing: ${file}.`);
    Object.assign(merged, parseEnvironmentFile(readFileSync(path, 'utf8')));
  }
  return merged;
}

/** Fails closed unless .firebaserc maps `prod` to the production project and the operator confirmed it. */
export function assertProdProjectConfig(configPath = resolve(CLOUD_ROOT, '.firebaserc'), env = process.env) {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error('PROD deployment blocked: .firebaserc is missing or malformed.');
  }
  const actualProjectId = config?.projects?.prod;
  if (actualProjectId !== PROD_PROJECT_ID) {
    throw new Error('PROD deployment blocked: prod alias does not point to the production project.');
  }
  if (config?.projects?.dev === PROD_PROJECT_ID) {
    throw new Error('PROD deployment blocked: dev alias points to the production project.');
  }
  if (env[PROD_CONFIRM_VARIABLE] !== PROD_PROJECT_ID) {
    throw new Error(`PROD deployment blocked: set ${PROD_CONFIRM_VARIABLE}=${PROD_PROJECT_ID} to confirm.`);
  }
  return PROD_PROJECT_ID;
}
