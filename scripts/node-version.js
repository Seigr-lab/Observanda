import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const pinnedNodeVersion = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();

export function checkNodeVersion(version = process.versions.node) {
  const [major, minor, patch] = pinnedNodeVersion.split('.').map(Number);
  const supported = `>=${pinnedNodeVersion} <${major + 1}`;
  const declared = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines.node;
  if (declared !== supported) throw new Error('The Node.js engine range and .nvmrc disagree.');
  const [actualMajor, actualMinor, actualPatch] = version.split('.').map(Number);
  if (!/^\d+\.\d+\.\d+$/.test(version) || actualMajor !== major ||
      actualMinor < minor || (actualMinor === minor && actualPatch < patch)) {
    throw new Error(`Observanda requires Node.js ${supported}. Found ${version}. Select the version in .nvmrc and retry.`);
  }
  return supported;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Node.js ${process.versions.node} (supported ${checkNodeVersion()}, desktop payload ${pinnedNodeVersion}).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
