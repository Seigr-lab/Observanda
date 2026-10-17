import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {checkLocales} from './check-locales.js';
import {checkSourceImports} from './check-source-imports.js';

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
      if (result.error) { console.error(`Unable to start syntax checker: ${file}`); process.exitCode = 1; continue; }
      if (result.status !== 0) { console.error(`Syntax check failed: ${file}`); process.exitCode = 1; }
    }
  }
}
await checkLocales();
await checkSourceImports();
await check('src'); await check('scripts'); await check('test'); await check('desktop');
if (!process.exitCode) console.log('JavaScript syntax checks passed.');
