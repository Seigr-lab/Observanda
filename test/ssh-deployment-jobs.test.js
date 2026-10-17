import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sshFixture} from './ssh-fixture.js';
import {SSHHost} from '../src/ssh-host.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {DeploymentJobs} from '../src/deployment-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';

async function run(queue){const job=await queue.claim();try{const output=await queue.definition(job).prepare(job,{signal:new AbortController().signal,progress:p=>queue.pulse(job.id,job.lease.token,p)});return await queue.complete(job.id,job.lease.token,output);}catch(error){return queue.release(job.id,job.lease.token,{error});}}
test('SSH jobs retain an uncertain switch and resume through a new publisher without uploading again',async t=>{
 const remote=await sshFixture(t),f=await encryptedFixture(remote.directory,sampleNotebook()),publisher=new Publisher(f.workspace.root,{ssh:remote.host},f.vault),jobs=workspaceJobs(f.workspace,publisher);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);});
 const config=defaultPublishing();config.kind='ssh';config.ssh=remote.config;config.publicUrl='https://synthetic.example/';const saved=await publisher.save(config,'new'),releases=new PublicationJobs(f.workspace);
 const {etag,websitePin}=await releases.workspace.outline();await releases.start({etag,websitePin},jobs.queue);const prepared=await run(jobs.queue);assert.equal(prepared.state,'completed');
 const deployments=new DeploymentJobs(f.workspace,publisher,jobs.queue),job=await deployments.start({id:prepared.result.id,reviewed:true,configEtag:saved.etag});let lost=false;
 remote.setHook((call,phase)=>{if(!lost&&phase==='after'&&call.args.at(-1).includes('mv -Tf')){lost=true;throw Error('Switch reply lost');}});
 assert.equal((await run(jobs.queue)).state,'failed');assert.equal(lost,true);const stored=await deployments.read(job.id);assert.equal(stored.journal.pushAttempted,true);assert.equal(stored.journal.receipt,undefined);await assert.rejects(publisher.save(config,saved.etag),{code:'PUBLISH_PENDING'});
 const uploads=remote.calls.filter(c=>c.program==='sftp').length,restarted=new Publisher(f.workspace.root,{ssh:new SSHHost(remote.run)},f.vault),again=workspaceJobs(f.workspace,restarted);t.after(()=>again.worker.stop());remote.setHook(null);await again.queue.control(job.id,'retry');const completed=await run(again.queue);assert.equal(completed.state,'completed',completed.error);
 assert.equal(remote.calls.filter(c=>c.program==='sftp').length,uploads);assert.equal((await restarted.read()).receipt.status,'uploaded-remote-verified');assert.equal((await restarted.read()).receipt.verification,undefined);assert.equal((await deployments.read(job.id)).journal.released,true);assert.equal((await deployments.page()).items[0].kind,'ssh');
});
