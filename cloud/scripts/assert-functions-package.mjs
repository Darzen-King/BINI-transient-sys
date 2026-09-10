import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const packagePath = resolve(root, 'packages/functions/package.json');
const bundlePath = resolve(root, 'packages/functions/dist/index.js');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const runtimeDependencies = Object.keys(pkg.dependencies ?? {});
const internalRuntimeDependency = runtimeDependencies.find((name) => name.startsWith('@bini/'));

if (internalRuntimeDependency) {
  throw new Error('Functions package contains a non-publishable internal runtime dependency.');
}

const bundle = readFileSync(bundlePath, 'utf8');
if (bundle.includes('@bini/cloud-shared')) {
  throw new Error('Functions bundle still imports the private workspace package.');
}

console.log('Functions deployment package is self-contained.');
