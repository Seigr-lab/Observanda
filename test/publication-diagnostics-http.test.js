import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {publicationDraftCommand,publicationText} from './publication-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withJobDiagnosticContext} from '../src/job-diagnostics.js';
import {startServer} from '../src/server.js';
import {clearVault} from '../src/encryption.js';

test('publication failure details require authentication and survive HTTP restart and retry without entering output',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-capture-diagnostics-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 let command,app,cookie,context,fault=true;const pin=PublicationJobs.prototype.pin;
 const mocked=t.mock.method(PublicationJobs.prototype,'pin',function(...args){
  if(fault)return withJobDiagnosticContext({operation:'capture-retained-figures',recordId:book.entries[0].id},()=>{const error=new Error('PRIVATE_DIAGNOSTIC_SENTINEL');error.code='25006';throw error;});
  return pin.apply(this,args);
 });
 t.after(async()=>{mocked.mock.restore();await app?.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const request=(operation,data)=>fetch(app.origin+'/api/publication-jobs/'+operation,{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json','X-Observanda-Workspace':context},body:JSON.stringify(data)});
 const call=async(operation,data)=>{const response=await request(operation,data),result=await response.json();assert.equal(response.ok,true,JSON.stringify(result));return result;};
 async function open(){
  app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
  const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});cookie=response.headers.get('set-cookie').split(';')[0];
  context=(await(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}})).json()).contextId;
 }
 async function terminal(){for(let i=0;i<600;i++){const {job}=await call('status',{id:command.commandId});if(['completed','failed','cancelled'].includes(job.state))return job;await delay(100);}assert.fail('Publication did not reach a terminal receipt');}
 await open();command={...await publicationDraftCommand(f.workspace,book),commandId:randomUUID()};const admitted=await request('start',command),admission=await admitted.json();assert.equal(admitted.status,202,JSON.stringify(admission));assert.equal(admission.job.id,command.commandId);
 const failed=await terminal();assert.equal(failed.error,'IO');assert.equal(failed.diagnostic.attempt,1);assert.doesNotMatch(JSON.stringify(failed),/PRIVATE_DIAGNOSTIC_SENTINEL|25006/);
 const details=await call('diagnostics',{id:command.commandId});assert.equal(details.diagnostic.context.recordId,book.entries[0].id);assert.equal(details.diagnostic.causes[0].code,'25006');
 const anonymous=await fetch(app.origin+'/api/publication-jobs/diagnostics',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({id:command.commandId})});assert.equal(anonymous.status,401);
 await app.close();fault=false;await open();assert.deepEqual(await call('diagnostics',{id:command.commandId}),details);
 await call('retry',{id:command.commandId});const done=await terminal();assert.equal(done.state,'completed',JSON.stringify(done));assert.equal(done.attempt,2);
 assert.deepEqual(await call('diagnostics',{id:command.commandId,attempt:1}),details);
 const edition=await new PublicationJobs(f.workspace).read(done.result.id);assert.doesNotMatch(await publicationText(edition),/PRIVATE_DIAGNOSTIC_SENTINEL|job-diagnostics|capture-retained-figures/);
});
