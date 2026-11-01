import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PublicationJobs,publicationJobDefinitions} from '../src/publication-jobs.js';
import {Workspace} from '../src/storage.js';

for(const supplied of [true,false])test('publication capture, cleanup and output use renewing checkpoints: '+(supplied?'worker':'direct'),async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-checkpoint-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let writes=0,checked=0;
 const write=async operation=>{writes++;return operation();};
 const queue={checkpoint:async(id,token,operation)=>{assert.equal(id,'job');assert.equal(token,'lease');checked++;return operation();},transaction:()=>{throw Error('Write bypassed renewing checkpoint');}};
 t.mock.method(PublicationJobs.prototype,'capture',async(_job,{write})=>write(()=>42));
 t.mock.method(PublicationJobs.prototype,'clean',async(_id,{write})=>write(()=>42));
 t.mock.method(PublicationJobs.prototype,'prepare',async(_job,{write})=>{await write(()=>42);return 'prepared';});
 const definitions=publicationJobDefinitions(new Workspace(root),()=>queue),job={id:'job',lease:{token:'lease'},input:{request:true}};
 assert.equal(await definitions['publication.prepare'].prepare(job,supplied?{write}:{}),'prepared');
 assert.equal(writes,supplied?3:0);assert.equal(checked,supplied?0:3);
});
