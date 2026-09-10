import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_DEV_PROJECT_ID = 'bini-transient-dev';

const PRODUCTION_PROJECT_ID = 'bini-transient';
const DEFAULT_CONFIG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.firebaserc',
);

export function assertDevProjectConfig(configPath = DEFAULT_CONFIG_PATH) {
  let rawConfig;

  try {
    rawConfig = readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error('DEV deployment blocked: .firebaserc is missing.');
    }

    throw new Error('DEV deployment blocked: .firebaserc cannot be read.');
  }

  let config;

  try {
    config = JSON.parse(rawConfig);
  } catch {
    throw new Error('DEV deployment blocked: .firebaserc is malformed JSON.');
  }

  const actualProjectId = config?.projects?.dev;

  if (typeof actualProjectId !== 'string' || actualProjectId.length === 0) {
    throw new Error('DEV deployment blocked: projects.dev alias is missing.');
  }

  if (actualProjectId === PRODUCTION_PROJECT_ID) {
    throw new Error('DEV deployment blocked: dev alias points to the production project.');
  }

  if (actualProjectId !== EXPECTED_DEV_PROJECT_ID) {
    throw new Error('DEV deployment blocked: dev alias points to an unexpected project.');
  }

  return EXPECTED_DEV_PROJECT_ID;
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const projectId = assertDevProjectConfig();
    console.log(`DEV project guard passed: ${projectId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'DEV deployment blocked.');
    process.exitCode = 1;
  }
}
