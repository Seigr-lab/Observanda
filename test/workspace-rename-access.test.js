import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {ProjectLocationAccess} from '../src/project-location-access.js';
import {ProjectSessionOwner} from '../src/project-session-owner.js';

function fixture(){
 const source=path.join(os.tmpdir(),'absent-rename-source-'+randomUUID()),destination=path.join(os.tmpdir(),'absent-rename-target-'+randomUUID()),projectId=randomUUID(),vaultId=randomUUID(),bookId=randomUUID(),bookVaultId=randomUUID(),namespaceId=randomUUID(),expires=Date.now()+60000;
 const receipt={source,destination,projects:[{projectId,vaultId,namespaceId,relative:'Project',books:[{labBookId:bookId,vaultId:bookVaultId,namespaceId:randomUUID(),directory:'Book'}]}]},client={},other={},sessions=new Map([[client,new Map()],[other,new Map()]]),application={workspace:{root:source},session:value=>sessions.get(value)},session=sessions.get(client),bookSessionId='book:'+projectId+':'+bookId;
 session.set(projectId,{root:path.join(source,'Project'),etag:'project-access',vault:{id:vaultId,key:Buffer.alloc(32,17)},expires});session.set(bookSessionId,{root:path.join(source,'Project','Book'),etag:'book-access',vault:{id:bookVaultId,key:Buffer.alloc(32,23)},expires});return {application,client,other,session,receipt,projectId,bookSessionId,expires};
}

test('rename capture uses only explicit unexpired requesting-client grants without opening the vanished source',async()=>{
 const f=fixture(),access=new ProjectLocationAccess(f.application,f.client),originalClose=ProjectSessionOwner.prototype.close,copies=[];
 ProjectSessionOwner.prototype.close=async function(){if(this.vault?.key)copies.push(this.vault.key);return originalClose.call(this);};
 try{
  access.captureRename(f.receipt);const book=access.books.owners.get(f.bookSessionId);assert.ok(book);assert.equal(book.access.expected,f.session.get(f.bookSessionId));assert.equal(book.access.expected.expires,f.expires);assert.equal(book.parent.sessionEntry.expires,f.expires);copies.push(book.vault.key);assert.notEqual(book.vault.key,f.session.get(f.bookSessionId).vault.key);
  const otherAccess=new ProjectLocationAccess(f.application,f.other);otherAccess.captureRename(f.receipt);assert.equal(otherAccess.books.owners.size,0);await otherAccess.close();await assert.rejects(access.install(f.application,f.other),{code:'ACCESS_DENIED'});
  await access.close();assert.ok(copies.length>=2);for(const key of copies)assert.ok(key.every(byte=>byte===0));assert.ok(f.session.get(f.projectId).vault.key.every(byte=>byte===17));assert.ok(f.session.get(f.bookSessionId).vault.key.every(byte=>byte===23));assert.equal(f.session.get(f.bookSessionId).expires,f.expires);
 }finally{await access.close();ProjectSessionOwner.prototype.close=originalClose;}
});

test('rename capture omits expired or locked grants and notices revocation after capture',async()=>{
 for(const kind of ['expired-project','locked-project','expired-book','locked-book','book-only','revoked-book','revoked-project']){
  const f=fixture();if(kind==='book-only')f.session.delete(f.projectId);
  if(kind==='expired-project')f.session.get(f.projectId).expires=Date.now()-1;
  if(kind==='locked-project')f.session.set(f.projectId,{locked:true});
  if(kind==='expired-book')f.session.get(f.bookSessionId).expires=Date.now()-1;
  if(kind==='locked-book')f.session.set(f.bookSessionId,{locked:true});
  const access=new ProjectLocationAccess(f.application,f.client);try{
   access.captureRename(f.receipt);const owner=access.books.owners.get(f.bookSessionId);
   if(kind.startsWith('expired')||kind.startsWith('locked'))assert.equal(owner,undefined,kind);
   else {assert.ok(owner,kind);assert.equal(access.books.valid(owner),true);if(kind==='book-only')assert.equal(owner.parent.vault,undefined);else {f.session.delete(kind==='revoked-book'?f.bookSessionId:f.projectId);assert.equal(access.books.valid(owner),false,kind);}}
  }finally{await access.close();}
 }
});
