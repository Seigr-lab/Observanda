// Material that test runs and builds create while they run stays inside this
// checkout, never in the system temporary folder: test fixtures and the test
// database in the git-ignored test/run, build scratch in the git-ignored dist.
import {mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const locations={'test-work':['test','run','work'],'test-runtime':['test','run','runtime'],work:['dist','work']};

// Returns the canonical path of the named working folder, created when missing.
export async function workDirectory(name='work'){
 if(!Object.hasOwn(locations,name))throw Error('Invalid work directory name');
 const directory=path.join(repositoryRoot,...locations[name]);
 await mkdir(directory,{recursive:true});
 return realpath(directory);
}
