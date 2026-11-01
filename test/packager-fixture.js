import {createRequire} from 'node:module';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// An isolated dependency installation can qualify the candidate without
// replacing dependencies used by another running test process.
const requested=process.env.OBSERVANDA_TEST_PACKAGER_ROOT;
if(requested&&!path.isAbsolute(requested))throw Error('Packager test root must be absolute.');
const root=await realpath(requested??fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(path.join(root,'package.json'));
const entry=require.resolve('app-builder-lib'),relative=path.relative(path.join(root,'node_modules'),entry);
if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Packager must belong to its selected test installation.');
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const builder=JSON.parse(await readFile(path.resolve(path.dirname(entry),'../package.json'),'utf8'));
if(builder.name!=='app-builder-lib'||builder.version!==manifest.devDependencies?.['electron-builder'])throw Error('Packager test installation does not match its declared builder.');

export const packagerDependency=async name=>import(pathToFileURL(require.resolve(name)).href);
export const packagerInternal=async relative=>{
 if(path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))throw Error('Invalid packager test module.');
 return import(pathToFileURL(path.join(path.dirname(entry),relative)).href);
};
