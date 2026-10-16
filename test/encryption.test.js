import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Workspace,atomicWrite,serialize,workspaceFile} from '../src/storage.js';
import {createAccess,takeCreatedVault,readAccess,verifyAccess,changeAccess} from '../src/access.js';
import {seal,unseal,clearVault,encrypted} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {CATALOGUE_FILE,CATALOGUE_ARCHIVE,openCatalogue} from '../src/research-catalogue.js';
async function assertEncryptedFile(root,relative){
 if(![CATALOGUE_FILE,CATALOGUE_ARCHIVE].includes(relative)){assert.ok(encrypted(await readFile(path.join(root,relative))),relative);return;}
 const db=await openCatalogue(root,{detached:true});
 try{
  // The SQL structure is visible, but all record, metadata, key and history
  // payloads must use authenticated encryption before entering its pages.
  for(const table of ['records','snapshots','scope_keys','state']){
   const rows=await db.all('SELECT payload FROM '+table);
   assert.ok(rows.length,table);
   for(const row of rows)assert.ok(encrypted(Buffer.from(row.payload)),table);
  }
 }finally{await db.close();}
}


test('authenticated encryption rejects modified ciphertext, wrong keys and swapped file identities',()=>{
 const key=randomBytes(32),plain=Buffer.from('private research'),a=seal(plain,key,'file-a'),b=seal(plain,key,'file-a');
 assert.ok(!a.equals(b));assert.deepEqual(unseal(a,key,'file-a'),plain);
 assert.throws(()=>unseal(a,randomBytes(32),'file-a'),{code:'ENCRYPTION_DAMAGED'});
 assert.throws(()=>unseal(a,key,'file-b'),{code:'ENCRYPTION_DAMAGED'});
 for(const offset of [0,8,20,36]){const changed=Buffer.from(a);changed[offset]^=1;assert.throws(()=>unseal(changed,key,'file-a'),{code:'ENCRYPTION_DAMAGED'});}
});
test('password wrapping, encrypted saves and history survive restart; changing password never rewrites research',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-crypto-'));
 const access=await createAccess('Owner','first synthetic password'),vault=takeCreatedVault(access),ws=new Workspace(root,vault);
 const initial=await ws.create(sampleNotebook()),originalDescription=initial.book.description;await atomicWrite(path.join(root,'.observanda','access.json'),serialize(access));
 const raw=await readFile(await workspaceFile(root));assert.ok(encrypted(raw));assert.ok(!raw.includes(Buffer.from(initial.book.title)));
 initial.book.description='Private changed description';const saved=await ws.save(initial.book,initial.etag);
 const revisions=await ws.history();assert.equal(revisions.length,1);assert.equal((await ws.readRevision(revisions[0].id)).description,originalDescription);await assertEncryptedFile(root,CATALOGUE_FILE);
 clearVault(vault);await assert.rejects(ws.read(),{code:'ACCESS_LOCKED'});await assert.rejects(new Workspace(root).read(),{code:'ACCESS_LOCKED'});
 const settings=await readAccess(root);await assert.rejects(verifyAccess(settings,'Owner','wrong'),{code:'ACCESS_DENIED'});
 const reopened=await verifyAccess(settings,'Owner','first synthetic password');const next=new Workspace(root,reopened);assert.equal((await next.read()).etag,saved.etag);
 const catalogueBefore=await readFile(path.join(root,CATALOGUE_FILE)),before=await readFile(await workspaceFile(root));await changeAccess(root,{username:'Owner',password:'second synthetic password',currentPassword:'first synthetic password'},settings.etag);
 assert.deepEqual(await readFile(await workspaceFile(root)),before);assert.deepEqual(await readFile(path.join(root,CATALOGUE_FILE)),catalogueBefore);await assert.rejects(verifyAccess(await readAccess(root),'Owner','first synthetic password'),{code:'ACCESS_DENIED'});
 const changed=await verifyAccess(await readAccess(root),'Owner','second synthetic password');assert.equal((await new Workspace(root,changed).read()).etag,saved.etag);
 await assert.rejects(changeAccess(root,{username:'Owner',password:'',currentPassword:'second synthetic password'},(await readAccess(root)).etag),{code:'ENCRYPT_PASSWORD'});
 const restored=await next.restore(revisions[0].id,saved.etag);assert.equal(restored.book.description,originalDescription);
 clearVault(reopened);clearVault(changed);
});


test('encrypted conversion preserves source bytes and encrypts every copied research file',async()=>{
 const {initializeLocation,encryptedCopy,copyPlan,workspaceManifest,inspectLocation}=await import('../src/locations.js');
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-convert-')),source=path.join(parent,'source'),destination=path.join(parent,'encrypted');
 await initializeLocation(source,sampleNotebook(),await createAccess());
 const ws=new Workspace(source),book=await ws.read();book.book.description='previous revision retained';await ws.save(book.book,book.etag);
 await atomicWrite(path.join(source,'.observanda','private-fixture'),'private original bytes');
 const before=await workspaceManifest(source),plan=await copyPlan(source,destination);
 const access=await createAccess('','another synthetic password'),vault=takeCreatedVault(access);
 await encryptedCopy(plan,access,vault);assert.deepEqual(await workspaceManifest(source),before);
 assert.equal((await inspectLocation(destination)).encrypted,true);
 for(const item of await workspaceManifest(destination))if(item.path!=='.observanda/access.json')assert.ok(encrypted(await readFile(path.join(destination,item.path))),item.path);
 assert.equal((await new Workspace(destination,vault).read()).book.description,'previous revision retained');
 assert.equal(await new Workspace(destination,vault).readFile(path.join(destination,'.observanda','private-fixture'),'utf8'),'private original bytes');clearVault(vault);
});


test('original and prepared image/audio/video files are encrypted, recoverable, and publishable only after unlock',async()=>{
 const {mediaFixtures}=await import('./media-fixtures.js'),{MediaStore}=await import('../src/media.js');
 const fixtures=await mediaFixtures(await mkdtemp(path.join(os.tmpdir(),'observanda-crypto-media-fixtures-')));
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-crypto-media-')),access=await createAccess('','media synthetic password'),vault=takeCreatedVault(access),ws=new Workspace(root,vault);
 await ws.create(sampleNotebook());const media=new MediaStore(root,vault);
 for(const kind of ['image','audio','video']){
  const asset=await media.import(fixtures[kind].bytes,kind),dir=path.join(root,'.observanda','media',asset.id);
  for(const name of await readdir(dir))assert.ok(encrypted(await readFile(path.join(dir,name))));
  assert.deepEqual(await ws.readFile(path.join(dir,'original')),fixtures[kind].bytes);assert.ok((await media.get(asset.id)).bytes.length);
 }
 clearVault(vault);const id=(await readdir(path.join(root,'.observanda','media')))[0];await assert.rejects(media.get(id),{code:'ACCESS_LOCKED'});
});


test('laboratory history and publishing configuration use the same encrypted boundary',async()=>{
 const {Laboratory}=await import('../src/laboratory.js'),{Publisher,defaultPublishing}=await import('../src/publishing.js');
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-crypto-lab-')),access=await createAccess('','laboratory synthetic password'),vault=takeCreatedVault(access),ws=new Workspace(root,vault);await ws.create(sampleNotebook());
 const lab=new Laboratory(root,vault);let current=await lab.read();
 current=await lab.change({etag:current.etag,action:'create-sample',sample:{code:'Private sample sentinel',material:'Synthetic',source:'Private source sentinel',collectedOn:'2026-09-25',receivedOn:'2026-09-26'}});
 await lab.change({etag:current.etag,action:'create-sample',sample:{code:'Second sample',material:'Synthetic',source:'',collectedOn:'2026-09-25',receivedOn:'2026-09-26'}});
 const publisher=new Publisher(root,{},vault),config=defaultPublishing();config.github.owner='private-owner';config.github.repository='private-destination';await publisher.save(config,'new');
 const {workspaceManifest}=await import('../src/locations.js');for(const file of await workspaceManifest(root))await assertEncryptedFile(root,file.path);
 assert.equal((await lab.read()).lab.samples[0].source,'Private source sentinel');assert.equal((await publisher.read()).config.github.owner,'private-owner');
 clearVault(vault);await assert.rejects(lab.read(),{code:'ACCESS_LOCKED'});await assert.rejects(publisher.read(),{code:'ACCESS_LOCKED'});
});

test('copying ciphertext preserves unlock and tampering never produces a replacement plaintext notebook',async()=>{
 const {initializeLocation,copyPlan,copyWorkspace}=await import('../src/locations.js');
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-cipher-copy-')),root=path.join(parent,'source'),target=path.join(parent,'copy');const access=await createAccess('','copy synthetic password'),vault=takeCreatedVault(access);
 await initializeLocation(root,sampleNotebook(),access,vault);await copyWorkspace(await copyPlan(root,target));
 const key=await verifyAccess(await readAccess(target),'','copy synthetic password'),ws=new Workspace(target,key);assert.ok((await ws.read()).book);
 const file=await workspaceFile(target),bytes=await readFile(file);bytes[bytes.length-1]^=1;await writeFile(file,bytes);await assert.rejects(ws.read(),{code:'ENCRYPTION_DAMAGED'});assert.deepEqual(await readFile(file),bytes);
 await writeFile(file,serialize(sampleNotebook()));await assert.rejects(ws.read(),{code:'ENCRYPTION_DAMAGED'});clearVault(vault);clearVault(key);
});


test('missing keys cannot create plaintext files in an encrypted workspace or initialize an encrypted header without its key',async()=>{
 const {initializeLocation}=await import('../src/locations.js');const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-key-boundary-')),root=path.join(parent,'secure');
 const access=await createAccess('','boundary synthetic password'),vault=takeCreatedVault(access);
 await assert.rejects(initializeLocation(root,sampleNotebook(),JSON.parse(serialize(access))),{code:'ACCESS_LOCKED'});
 await initializeLocation(root,sampleNotebook(),access,vault);const {Laboratory}=await import('../src/laboratory.js'),locked=new Workspace(root);
 await assert.rejects(locked.writeFile(path.join(root,'.observanda','new-file'),'plaintext'),{code:'ACCESS_LOCKED'});
 const lab=new Laboratory(root);await assert.rejects(lab.change({action:'create-sample',etag:'new',sample:{code:'Forbidden',material:'Synthetic',source:'',collectedOn:'2026-09-25',receivedOn:'2026-09-26'}}),{code:'ACCESS_LOCKED'});
 await assert.rejects(readFile(path.join(root,'.observanda','laboratory.json')),{code:'ENOENT'});clearVault(vault);
});
