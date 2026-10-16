import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,unlink,access,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {CATALOGUE_FILE,CATALOGUE_ARCHIVE,openCatalogue} from '../src/postgres.js';
import {CATALOGUE_ACTIVATION} from '../src/postgres-activation.js';
import {sampleNotebook} from '../src/sample.js';
import {interruptWorkspace as interrupt} from './fixtures/interrupt-workspace.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-activation-crash-'));
 const access=await createAccess('','synthetic recovery password'),vault=takeCreatedVault(access),source=path.join(directory,'source');
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 await initializeLocation(source,sampleNotebook(),access,vault);
 const workspace=new Workspace(source,vault),before=await workspace.read();
 const backup=await copyWorkspace(await copyPlan(source,path.join(directory,'backup')),{vault});
 return {directory,source,vault,workspace,before,backup};
}

test('a killed restore resumes its committed catalogue instead of abandoning it',async t=>{
 const f=await fixture(t),archive=await readFile(path.join(f.backup,CATALOGUE_ARCHIVE));
 const stopped=await interrupt(f.backup,f.vault,'commit');
 assert.deepEqual(await readFile(path.join(f.backup,CATALOGUE_ARCHIVE)),archive);
 await assert.rejects(access(path.join(f.backup,CATALOGUE_FILE)),{code:'ENOENT'});
 const recovered=new Workspace(f.backup,f.vault);assert.deepEqual(await recovered.read(),f.before);
 const binding=JSON.parse(await readFile(path.join(f.backup,CATALOGUE_FILE)));
 assert.equal('obs_'+binding.id.replaceAll('-',''),stopped.schema,'resume the verified schema committed by the interrupted process');
 await assert.rejects(access(path.join(f.backup,CATALOGUE_ARCHIVE)),{code:'ENOENT'});
 assert.deepEqual(await f.workspace.read(),f.before);
});

test('a restore killed before commit reimports the unchanged archive with its checkpoint identity',async t=>{
 const f=await fixture(t),archive=await readFile(path.join(f.backup,CATALOGUE_ARCHIVE));
 const stopped=await interrupt(f.backup,f.vault,'before-commit');
 const pending=JSON.parse(await readFile(path.join(f.backup,CATALOGUE_ACTIVATION)));
 assert.deepEqual(await readFile(path.join(f.backup,CATALOGUE_ARCHIVE)),archive);
 await assert.rejects(access(path.join(f.backup,CATALOGUE_FILE)),{code:'ENOENT'});
 const recovered=new Workspace(f.backup,f.vault);assert.deepEqual(await recovered.read(),f.before);
 const binding=JSON.parse(await readFile(path.join(f.backup,CATALOGUE_FILE)));
 assert.equal(binding.id,pending.id);assert.equal('obs_'+binding.id.replaceAll('-',''),stopped.schema);
 await assert.rejects(access(path.join(f.backup,CATALOGUE_ACTIVATION)),{code:'ENOENT'});
 await assert.rejects(access(path.join(f.backup,CATALOGUE_ARCHIVE)),{code:'ENOENT'});
 assert.deepEqual(await f.workspace.read(),f.before);
});

test('activation resumes after retiring the archive and refuses mismatched checkpoints',async t=>{
 const f=await fixture(t);await interrupt(f.backup,f.vault,'checkpoint');
 const file=path.join(f.backup,CATALOGUE_ACTIVATION),original=await readFile(file),pending=JSON.parse(original);
 const sourceBinding=JSON.parse(await readFile(path.join(f.source,CATALOGUE_FILE)));
 await assert.rejects(access(path.join(f.backup,CATALOGUE_ARCHIVE)),{code:'ENOENT'});
 await writeFile(file,JSON.stringify({...pending,id:sourceBinding.id}));
 const restored=new Workspace(f.backup,f.vault);
 await assert.rejects(restored.read(),{code:'CATALOGUE_DAMAGED'});
 await writeFile(file,original);
 assert.deepEqual(await restored.read(),f.before);
 await assert.rejects(access(file),{code:'ENOENT'});
 assert.deepEqual(await f.workspace.read(),f.before);
});

test('resumed activation authenticates its committed records before retiring the recovery source',async t=>{
 const f=await fixture(t),stopped=await interrupt(f.backup,f.vault,'commit'),archive=await readFile(path.join(f.backup,CATALOGUE_ARCHIVE));
 const db=await openCatalogue(f.source);
 try{
  const row=await db.get('SELECT id,revision,payload FROM "'+stopped.schema+'".records LIMIT 1'),damaged=Buffer.from(row.payload);damaged[damaged.length-1]^=1;
  await db.run('UPDATE "'+stopped.schema+'".records SET payload=$1 WHERE id=$2 AND revision=$3',damaged,row.id,row.revision);
  await assert.rejects(new Workspace(f.backup,f.vault).read(),{code:'ENCRYPTION_DAMAGED'});
  assert.deepEqual(await readFile(path.join(f.backup,CATALOGUE_ARCHIVE)),archive);
  await assert.rejects(access(path.join(f.backup,CATALOGUE_FILE)),{code:'ENOENT'});
  // Only the fixture repairs the corrupted synthetic payload. Retrying the app
  // must reuse the same verified identity after the corruption is resolved.
  await db.run('UPDATE "'+stopped.schema+'".records SET payload=$1 WHERE id=$2 AND revision=$3',row.payload,row.id,row.revision);
 }finally{await db.close();}
 assert.deepEqual(await new Workspace(f.backup,f.vault).read(),f.before);
 assert.deepEqual(await f.workspace.read(),f.before);
});

test('a killed archive retirement finishes before authoring and cannot resurrect old records',async t=>{
 const f=await fixture(t);await interrupt(f.backup,f.vault,'retire');
 const binding=await readFile(path.join(f.backup,CATALOGUE_FILE));
 await access(path.join(f.backup,CATALOGUE_ARCHIVE));
 const recovered=new Workspace(f.backup,f.vault);assert.deepEqual(await recovered.read(),f.before);
 assert.deepEqual(await readFile(path.join(f.backup,CATALOGUE_FILE)),binding);
 await assert.rejects(access(path.join(f.backup,CATALOGUE_ARCHIVE)),{code:'ENOENT'});
 const next=structuredClone(f.before.book);next.entries[0].title='Authored after interrupted recovery';
 const saved=await recovered.save(next,f.before.etag);assert.equal(saved.book.entries[0].title,next.entries[0].title);
 const second=await copyWorkspace(await copyPlan(f.backup,path.join(f.directory,'second')),{vault:f.vault});
 assert.deepEqual(await new Workspace(second,f.vault).read(),saved);
 await unlink(path.join(f.backup,CATALOGUE_FILE));
 await assert.rejects(recovered.read(),{code:'CATALOGUE_DAMAGED'});
 assert.deepEqual(await f.workspace.read(),f.before);
});
