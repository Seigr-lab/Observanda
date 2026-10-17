import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {RecordOwnerSession} from '../src/record-owner-session.js';
import {recordOwnerTransferRequest} from '../src/record-owner-transfer-application.js';
import {AppError} from '../src/errors.js';

test('record transfer routing preserves the selected source owner and keeps status read-only',()=>{
 const projectId=randomUUID(),labBookId=randomUUID(),suffix='/research/records/transfer/';
 for(const [prefix,owner] of [['/api',{}],['/api/projects/'+projectId,{projectId}],['/api/projects/'+projectId+'/lab-books/'+labBookId,{projectId,labBookId}]]){
  for(const operation of ['start','resume','cancel','status']){
   const command=projectRequest(prefix+suffix+operation,'POST');assert.ok(command);assert.equal(command.recordTransfer,operation);assert.equal(command.write,operation!=='status');
   assert.equal(command.projectId,owner.projectId);assert.equal(command.labBookId,owner.labBookId);assert.equal(command.limit,16384);
   assert.equal(projectRequest(prefix+suffix+operation,'GET'),null);
  }
 }
 assert.equal(recordOwnerTransferRequest('/api/research/records/transfer/erase','POST'),null);
});

test('record owner sessions authorize books separately and enforce revocation through final checks',{timeout:180000},async t=>{
 const f=await projectTreeFixture(t),app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={},book=f.books[0];t.after(()=>app.close());
 const owner={projectId:book.projectId,labBookId:book.labBookId,workspaceId:book.namespaceId},selected={projectId:book.projectId,labBookId:book.labBookId,operation:'lab-books/access/unlock',bookOperation:'access'};
 const denied=new RecordOwnerSession(app,client,owner);
 try{await assert.rejects(denied.use(()=>assert.fail('Protected book opened without its grant')),error=>['ACCESS_LOCKED','DEVICE_UNKNOWN'].includes(error.code)&&error.projectId===book.projectId&&error.labBookId===book.labBookId);}finally{await denied.close();}
 await app.run(client,selected,{username:'',password:'Protected observations 456!'});
 const opened=new RecordOwnerSession(app,client,owner);let ownedKey;
 try{await opened.use(async(storage,check)=>{
  assert.equal(storage.labBookId,book.labBookId);assert.equal((await storage.outline()).metadata.id,book.namespaceId);ownedKey=storage.vault.key;
  // An unrelated book grant is not required, and the caller's source grant
  // cannot be revoked without stopping this destination at its next boundary.
  const id='book:'+book.projectId+':'+book.labBookId;app.forget(app.session(client),id);app.session(client).set(id,{locked:true});
  await assert.rejects(check(),error=>error.code==='ACCESS_LOCKED'&&error.projectId===book.projectId&&error.labBookId===book.labBookId);
  throw new AppError('ACCESS_LOCKED');
 });assert.fail('Revoked request completed');}catch(error){assert.equal(error.code,'ACCESS_LOCKED');}finally{await opened.close();}
 assert.ok(ownedKey.every(byte=>byte===0));assert.ok(book.key.key.some(byte=>byte!==0));
 await app.run(client,selected,{username:'',password:'Protected observations 456!'});
 const wrong=new RecordOwnerSession(app,client,{...owner,workspaceId:randomUUID()});
 try{await assert.rejects(wrong.use(()=>assert.fail('Namespace substitution accepted')),{code:'WORKSPACE_CHANGED'});}finally{await wrong.close();}
 const parentId=book.projectId;
 await app.unlock(client,parentId,{username:'',password:''});
 const expired=app.session(client).get(parentId);assert.ok(expired?.vault);const expiredKey=expired.vault.key;expired.expires=Date.now()-1;
 const renewed=new RecordOwnerSession(app,client,{projectId:parentId,labBookId:null,workspaceId:f.projects[0].namespaceId});
 try{await renewed.use(storage=>assert.equal(storage.projectId,parentId));}finally{await renewed.close();}
 assert.equal(expired.vault.key,null);assert.ok(expiredKey.every(byte=>byte===0));
 app.forget(app.session(client),parentId);app.session(client).set(parentId,{locked:true});
 const parentDenied=new RecordOwnerSession(app,client,owner);
 try{await assert.rejects(parentDenied.use(()=>assert.fail('Parent authorization skipped')),error=>error.code==='ACCESS_LOCKED'&&error.projectId===parentId&&error.labBookId===undefined);}finally{await parentDenied.close();}
 const root=new RecordOwnerSession(app,client,{projectId:null,labBookId:null,workspaceId:f.registry.workspaceId});
 try{await root.use(async storage=>assert.equal(storage.root,f.root));}finally{await root.close();}
 assert.ok(f.workspace.vault.key.some(byte=>byte!==0));
});
