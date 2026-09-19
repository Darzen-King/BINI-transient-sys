import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertProdProjectConfig } from './deploy-target.mjs';

export { assertProdProjectConfig };

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const projectId = assertProdProjectConfig();
    console.log(`PROD project guard passed: ${projectId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'PROD deployment blocked.');
    process.exitCode = 1;
  }
}
