import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {TestDeviceStore} from './device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';
import {retainProjectMetadataOwnership} from '../src/project-metadata-ownership.js';
import {retiredMetadataLocation,retainedMetadataSlot} from '../src/project-retired-metadata.js';
import {requireRetiredProjectRecords} from '../src/catalogue-format.js';
export async function retiredProjectProofFixture(t,{objects=64}={}){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-retired-proof-')),manager=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(manager),vaults=[];
 t.after(async()=>{await manager.close();detach();for(const vault of vaults)await clearVault(vault);assert.equal(path.dirname(path.resolve(parent)),path.resolve(os.tmpdir()));assert.match(path.basename(parent),/^observanda-retired-proof-/);await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook(),from=await encryptedFixture(path.join(parent,'source'),book);vaults.push(from.vault);
 const projectBook=structuredClone(book),projectId=projectBook.projects[0].id;projectBook.id=randomUUID();projectBook.title='Owned project';projectBook.projects[0].title=projectBook.title;
 const device=new TestDeviceStore({file:path.join(parent,'project.device')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
 const project=await initializeProjectLocation(path.join(parent,'Owned project'),projectId,projectBook,access,vault),source=from.workspace;
 const receipt={version:1,operationId:randomUUID(),projectId,sourceNamespace:book.id,namespaceId:projectBook.id,vaultId:vault.id,sourceHead:await source.catalogue(store=>store.head())};
 const values=Array.from({length:objects},(_,n)=>({id:'metadata:.observanda/proof/item-'+String(n).padStart(5,'0')+'.json',value:{text:JSON.stringify({version:1,ordinal:n,retained:'original-'+n})}}));
 for(const row of values)row.revision=digest(serialize(row.value));
 await source.withLock(()=>source.catalogue(async store=>{for(const row of values)await store.putObject(row.id,row.value);await requireRetiredProjectRecords(store.db);}));
 await project.withLock(()=>project.catalogue(async store=>{
  await store.putObject('project:adoption',{version:1,ready:true,receipt});
  await retainProjectMetadataOwnership(store,receipt,values.map(row=>({id:row.id,sourceRevision:row.revision,owner:{kind:'project',projectId}})));
  for(const row of values){const slot=retainedMetadataSlot(row.revision);await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,row.value));}
 }));
 await source.withLock(()=>source.catalogue(async store=>{
  const slot='project-source-authority:project:'+projectId;await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,receipt));
  for(const row of values)await store.db.run('UPDATE objects SET payload=$2 WHERE id=$1',row.id,store.encode('object',row.id,retiredMetadataLocation(receipt,row.id,row.revision)));
 }));
 return {parent,manager,source,project,receipt,values,device,access};
}
