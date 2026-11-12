// Working folders for repository scripts and tests live inside this checkout,
// in the git-ignored .local folder, never in the system temporary folder: what
// a build or test run writes stays with the repository and survives a crash.
import {mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Returns the canonical path of .local/<name>, created when missing.
export async function workDirectory(name='work'){
 if(!/^[a-z][a-z0-9-]*$/.test(name))throw Error('Invalid work directory name');
 const directory=path.join(repositoryRoot,'.local',name);
 await mkdir(directory,{recursive:true});
 return realpath(directory);
}
