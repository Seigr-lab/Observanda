// A single maintained SHA-256 implementation for incremental browser hashing.
// Keep this bundle reproducible and ship the dependency's complete license.
import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('src/web/vendor',{recursive:true});
await build({stdin:{contents:"export {sha256} from '@noble/hashes/sha2.js';",resolveDir:process.cwd()},outfile:'src/web/vendor/sha256.js',bundle:true,platform:'browser',format:'esm',target:['es2022'],minify:true,legalComments:'none'});
await writeFile('src/web/vendor/sha256-LICENSE.txt',await readFile('node_modules/@noble/hashes/LICENSE'));
