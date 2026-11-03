import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {localStopWitness} from '../src/postgres-stop-witness.js';

test('a crash witness binds the original workspace, owner, directory, lock file and ready server bytes',async()=>{
 const data=path.resolve('test-cluster'),workspace={vault:{id:'workspace'},ownerId:'installation',deleteId:'frozen-deletion'};
 const config={running:true,ownerId:'installation',port:5432};
 const file={identity:'lock-file',bytes:Buffer.from(['1234',data,'6789','5432','','','','ready',''].join('\n'))};
 const cluster={identity:'cluster'},guard={identity:'runtime',files:{
  async readIdentified(selected,limit){assert.equal(selected,path.join(data,'postmaster.pid'));assert.equal(limit,16384);return file;},
  async stat(selected,options){assert.equal(selected,data);assert.deepEqual(options,{directory:true});return cluster;}
 },stopWitness:async({binding,ticket})=>ticket?{stopped:ticket===binding}:{ticket:binding}};
 const check=verify=>localStopWitness({guard,config,workspace,data,verify});
 config.localStopTicket=(await check(false)).ticket;
 assert.equal((await check(true)).stopped,true);
 for(const [object,key,value] of [[file,'identity','replacement'],[cluster,'identity','replacement'],[guard,'identity','replacement'],[workspace.vault,'id','different-workspace'],[file,'bytes',Buffer.from(file.bytes.toString().replace('6789','6790'))]]){
  const original=object[key];object[key]=value;
  assert.equal((await check(true)).stopped,false);
  object[key]=original;
 }
 workspace.ownerId='different-installation';assert.equal(await check(true),null);
});

test('ineligible volumes, older configs and unfrozen deletion cannot request a stopped witness or inspect the PID file',async()=>{
 const workspace={ownerId:'installation',vault:{id:'workspace'},deleteId:'delete'};
 const config={ownerId:'installation',running:true};
 const files={readIdentified:()=>assert.fail('unnecessary pidfile read')},guard={files};
 const check=()=>localStopWitness({guard,config,workspace,data:path.resolve('test-cluster'),verify:true});
 assert.equal(await check(),null);
 guard.stopWitness=()=>assert.fail('unauthorized witness');
 assert.equal(await check(),null);
 config.localStopTicket='old-ticket';delete workspace.deleteId;
 assert.equal(await check(),null);
});
