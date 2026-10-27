import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {runtimeCommand} from '../src/postgres-runtime.js';

test('runtime helper cancellation acknowledges actual child exit and retains all short output',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-command-')),file=path.join(root,'ready');t.after(()=>rm(root,{recursive:true,force:true}));
 const controller=new AbortController(),pending=runtimeCommand(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",file],{signal:controller.signal});
 const rejected=assert.rejects(pending,{code:'DATABASE_CANCELLED'});let pid;
 try{for(let index=0;index<200&&!pid;index++){try{pid=Number(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}if(!pid)await delay(10);}assert.ok(pid);}finally{controller.abort();}
 await rejected;assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 assert.equal(await runtimeCommand(process.execPath,['-e',"process.stdout.write('complete output')"]),'complete output');
 await assert.rejects(runtimeCommand(path.join(root,'missing-executable'),[]),{code:'DATABASE_INSTALL'});
});
