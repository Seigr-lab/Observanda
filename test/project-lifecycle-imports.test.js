import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

for(const name of ['workspace-deletion','workspace-project-deletion','workspace-project-rename','project-deletion'])test(name+' initializes in a fresh process without preloading owner classes',async()=>{
 const entry=new URL('../src/'+name+'.js',import.meta.url).href;
 await promisify(execFile)(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(entry)+')'],{windowsHide:true,timeout:30000,maxBuffer:65536});
});
