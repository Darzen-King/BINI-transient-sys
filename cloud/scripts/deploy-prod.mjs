import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROD_PROJECT_ID, assertProdProjectConfig } from './deploy-target.mjs';

const CLOUD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  const [what] = process.argv.slice(2);
  assertProdProjectConfig();
  // The Dropbox backup is switched per project in packages/functions/.env.<projectId>, not here.
  if (!['firestore', 'functions', 'hosting'].includes(what)) {
    throw new Error('Usage: deploy-prod.mjs <firestore|functions|hosting>');
  }
  console.log(`Deploying to PROD (${PROD_PROJECT_ID}): ${what}`);
  const args = ['firebase', 'deploy', '--only', what, '--project', PROD_PROJECT_ID, '--non-interactive'];
  // processOperationRequest retries on failure; non-interactive deploys must acknowledge that with --force (as DEV does).
  if (what === 'functions') args.push('--force');
  const result = spawnSync('npx', args, {
    cwd: CLOUD_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = result.status ?? 1;
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'PROD deployment failed.');
    process.exitCode = 1;
  }
}
