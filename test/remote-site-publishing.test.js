import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {buildPublication} from '../src/publication.js';
import {memoryHost} from './remote-host-fixture.js';
import {deployRemoteSite,REMOTE_OWNER_MARKER} from '../src/remote-site-publishing.js';

const config={directory:'/public_html'};
const site=(host,candidate)=>[...candidate.files.keys()].every(name=>host.files.get('/public_html/'+name)?.equals(Buffer.from(candidate.files.get(name))));
const uploadFolders=host=>[...host.directories].filter(name=>name.startsWith('/public_html/.observanda-upload-'));

test('a website is published in place, unchanged files are not sent again, and only its own earlier files are removed',async()=>{
 const host=memoryHost(),owner=randomUUID(),book=sampleNotebook(),first=buildPublication(book);
 const journal={},receipt=await deployRemoteSite(host.transport,config,first,owner,{journal});
 assert.equal(receipt.releaseId,first.id);assert.equal(receipt.status,'uploaded-remote');assert.equal(journal.released,true);
 assert.equal(host.files.get('/public_html/'+REMOTE_OWNER_MARKER).toString(),owner);
 assert.ok(site(host,first));assert.deepEqual(uploadFolders(host),[]);
 assert.equal(Object.keys(journal.remote).length,first.files.size);assert.equal(host.counts.upload,first.files.size);

 // A file the author placed by hand is never touched.
 host.files.set('/public_html/robots.txt',Buffer.from('kept'));
 const changed=structuredClone(book);changed.title='A revised lab book';const removedEntry=changed.entries.find(entry=>entry.share===true);changed.entries=changed.entries.filter(entry=>entry!==removedEntry);
 const second=buildPublication(changed),gone=[...first.files.keys()].filter(name=>!second.files.has(name)),same=[...second.files.keys()].filter(name=>first.files.has(name)&&Buffer.from(first.files.get(name)).equals(Buffer.from(second.files.get(name))));
 assert.ok(gone.length>0,'the removed record leaves files behind');assert.ok(same.length>0,'some files are unchanged');
 const before=host.counts.upload,next={},again=await deployRemoteSite(host.transport,config,second,owner,{journal:next,previousFiles:journal.remote});
 assert.equal(again.releaseId,second.id);assert.ok(site(host,second));
 assert.equal(host.counts.upload-before,second.files.size-same.length,'only new and changed files are uploaded');
 for(const name of gone)assert.equal(host.files.has('/public_html/'+name),false,name);
 assert.equal(host.files.get('/public_html/robots.txt').toString(),'kept');
 assert.deepEqual(Object.keys(next.remote).sort(),[...second.files.keys()].sort());assert.deepEqual(uploadFolders(host),[]);
});

test('a folder that already holds files is used only when the author allows it, and another owner is refused',async()=>{
 const host=memoryHost(),owner=randomUUID(),candidate=buildPublication(sampleNotebook());
 host.files.set('/public_html/index.html',Buffer.from('host default page'));host.files.set('/public_html/.htaccess',Buffer.from('rules'));host.directories.add('/public_html');
 await assert.rejects(deployRemoteSite(host.transport,config,candidate,owner,{journal:{}}),{code:'PUBLISH_OWNERSHIP'});
 assert.equal(host.files.has('/public_html/'+REMOTE_OWNER_MARKER),false);
 await deployRemoteSite(host.transport,config,candidate,owner,{journal:{},allowExisting:true});
 assert.ok(site(host,candidate));assert.equal(host.files.get('/public_html/.htaccess').toString(),'rules');
 await assert.rejects(deployRemoteSite(host.transport,config,candidate,randomUUID(),{journal:{},allowExisting:true}),{code:'PUBLISH_OWNERSHIP'});
});

test('an interrupted publication resumes from its journal at every step and leaves no upload folder',async()=>{
 for(const step of ['upload','replace','remove']){
  const host=memoryHost(),owner=randomUUID(),book=sampleNotebook(),first=buildPublication(book),earlier={};
  await deployRemoteSite(host.transport,config,first,owner,{journal:earlier});
  const changed=structuredClone(book);changed.title='Changed '+step;changed.entries=changed.entries.filter(entry=>entry.share!==true||entry!==changed.entries.find(item=>item.share===true));
  const second=buildPublication(changed);let saved=null;
  host.fail(step);
  await assert.rejects(deployRemoteSite(host.transport,config,second,owner,{journal:{},previousFiles:earlier.remote,save:async value=>{saved=value;}}),error=>error.message==='connection lost'||error.code==='PUBLISH_FTP');
  assert.ok(saved?.nonce,step);
  const receipt=await deployRemoteSite(host.transport,config,second,owner,{journal:structuredClone(saved),save:async value=>{saved=value;}});
  assert.equal(receipt.releaseId,second.id,step);assert.ok(site(host,second),step);assert.deepEqual(uploadFolders(host),[],step);
  for(const name of first.files.keys())if(!second.files.has(name))assert.equal(host.files.has('/public_html/'+name),false,step+' '+name);
 }
});

test('a later publication removes an upload folder an abandoned publication left behind',async()=>{
 const host=memoryHost(),owner=randomUUID(),candidate=buildPublication(sampleNotebook());
 await deployRemoteSite(host.transport,config,candidate,owner,{journal:{}});
 host.directories.add('/public_html/.observanda-upload-'+randomUUID());
 await deployRemoteSite(host.transport,config,candidate,owner,{journal:{}});
 assert.deepEqual(uploadFolders(host),[]);
});
