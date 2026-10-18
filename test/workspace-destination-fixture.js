import assert from 'node:assert/strict';
import {lstat,mkdtemp,realpath,rm,stat} from 'node:fs/promises';
import path from 'node:path';

// Opt-in mounted destinations contain only disposable test-owned children.
export async function workspaceDestinationFixture(localDirectory){
 const requested=process.env.OBSERVANDA_TEST_SECOND_VOLUME;
 if(!requested)return {root:localDirectory,cleanup:async()=>{}};
 const parent=path.resolve(await realpath(requested));
 assert.notEqual((await stat(localDirectory)).dev,(await stat(parent)).dev,'The destination must be a different mounted volume');
 const root=await mkdtemp(path.join(parent,'observanda-workspace-destination-')),identity=await lstat(root);
 assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-workspace-destination-'));
 return {root,cleanup:async()=>{
  let current;try{current=await lstat(root);}catch(error){if(error.code==='ENOENT')return;throw error;}
  assert.ok(current.isDirectory()&&!current.isSymbolicLink(),'Disposable destination was replaced');
  assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);
  const resolved=await realpath(root);assert.equal(resolved,root);assert.equal(path.dirname(resolved),parent);
  assert.ok(path.basename(resolved).startsWith('observanda-workspace-destination-'));
  await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }};
}
