import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,symlink,unlink} from 'node:fs/promises';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {buildPublication} from '../src/publication.js';
import {sshFixture} from './ssh-fixture.js';
import {SSHHost} from '../src/ssh-host.js';

test('real shell SSH protocol resumes lost claim, sealed release and switch responses without new uploads',async t=>{
 for(const point of ['claim','seal','switch','unlock'])await t.test(point,async t=>{
  const f=await sshFixture(t),book=sampleNotebook(),candidate=buildPublication(book),journal={};let stored={},lost=false;
  const save=value=>{stored=structuredClone(value);};
  f.setHook((call,phase)=>{const command=call.args.at(-1),match=point==='claim'?command.includes('.observanda-owner'):point==='seal'?command.includes('mv -T ')&&!command.includes('mv -Tf'):point==='switch'?command.includes('mv -Tf'):command.includes('rm ')&&command.includes('.publishing-lock');if(phase==='after'&&match&&!lost){lost=true;throw Error('Lost acknowledgement');}});
  await assert.rejects(f.host.deploy(f.config,candidate,book.id,{journal,save}));assert.equal(lost,true);
  if(point==='switch'||point==='unlock')assert.ok((await f.current()).endsWith(candidate.id));
  const uploaded=f.calls.filter(c=>c.program==='sftp').length;f.setHook(null);
  const receipt=await new SSHHost(f.run).deploy(f.config,candidate,book.id,{journal:structuredClone(stored),save});
  assert.equal(receipt.releaseId,candidate.id);assert.equal(stored.released,true);assert.ok((await f.current()).endsWith(candidate.id));
  if(point!=='claim')assert.equal(f.calls.filter(c=>c.program==='sftp').length,uploaded);
  assert.equal((await readFile(path.join(f.directory,'site','current','publication.json'),'utf8')),candidate.files.get('publication.json'));
 });
});
test('SSH stops on unexpected remote edits or corruption and never replaces a different operation claim',async t=>{
 const f=await sshFixture(t),book=sampleNotebook(),candidate=buildPublication(book),journal={};let once=true;
 f.setHook(async(call,phase)=>{if(once&&call.program==='sftp'&&phase==='after'){once=false;await writeFile(path.join(f.directory,'site','.stage-'+journal.nonce,'index.html'),'corrupt');}});
 await assert.rejects(f.host.deploy(f.config,candidate,book.id,{journal}));await assert.rejects(f.current(),{code:'ENOENT'});
 f.setHook(null);await assert.rejects(f.host.deploy(f.config,candidate,book.id,{journal:{}}));
 const claim=path.join(f.directory,'site','.publishing-lock');assert.ok((await readFile(path.join(f.directory,'site','.observanda-owner'),'utf8')).includes(book.id));
 // Repair only the fixture's corrupted stage and retain the same operation.
 await writeFile(path.join(f.directory,'site','.stage-'+journal.nonce,'index.html'),candidate.files.get('index.html'));
 await symlink('releases/'+'a'.repeat(64),path.join(f.directory,'site','current'),'junction').catch(async()=>symlink('releases/'+'a'.repeat(64),path.join(f.directory,'site','current')));
 await assert.rejects(f.host.deploy(f.config,candidate,book.id,{journal}));assert.ok(!(await f.current()).endsWith(candidate.id));
 await unlink(path.join(f.directory,'site','current'));await f.host.deploy(f.config,candidate,book.id,{journal});await assert.rejects(readFile(claim),{code:'ENOENT'});
});
