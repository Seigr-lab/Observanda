// Projects and lab books live inside a workspace folder and use the single
// database cluster of that workspace. Fixtures that need owners create this
// open workspace first and place every owner below its root.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {createNotebook} from '../src/model.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {LabBookImports} from '../src/lab-book-import.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from '../src/postgres-activation.js';
import {assertRegular} from '../src/storage.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';

export async function ownerWorkspace(directory,{name='owner workspace',book=sampleNotebook()}={}){
 const fixture=await encryptedFixture(path.join(directory,name),book);
 return {root:fixture.workspace.root,workspace:fixture.workspace,vault:fixture.vault,deviceStore:fixture.deviceStore};
}

// "Copy to…" writes a lab book outside every workspace in archive form: no
// catalogue binding, a catalogue archive, and no database cluster of its own.
export async function assertArchiveCopy(root){
 if(await catalogueBinding(root)!==null)throw Error('A copy outside a workspace must not be bound to a database');
 if(!await assertRegular(path.join(root,CATALOGUE_ARCHIVE),{missing:true}))throw Error('A copy outside a workspace must carry its catalogue archive');
 if(await assertRegular(path.join(root,'.observanda','postgresql'),{directory:true,missing:true}))throw Error('A copy must never carry a database cluster');
}

// Brings an archive-form lab book into a new workspace through the product's
// own import, as a person does with a copy, and returns the imported book.
// `vaults` receives every key the caller must clear.
export async function importLabBookCopy(directory,{deviceStore,source,password,labBookId,vault,vaults,name='import workspace '+randomUUID()}){
 const home=await ownerWorkspace(directory,{name,book:createNotebook('Receiving workspace')});vaults.push(home.vault);
 const registry=new ProjectRegistry(home.workspace,(await home.workspace.outline()).metadata.id);
 const metadata=createNotebook('Receiving project'),projectId=randomUUID(),access=await createWorkspaceAccess('','',deviceStore),projectVault=takeCreatedVault(access);vaults.push(projectVault);
 metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 const project=await initializeProjectLocation(path.join(home.root,metadata.title),projectId,metadata,access,projectVault);await registry.attach(project,{expected:(await registry.read()).revision});
 const result=await new LabBookImports(project,registry,deviceStore).run({id:randomUUID(),path:source,username:'',password,recovery:''});
 if(!result.complete)throw Error('The import did not complete');
 return new LabBookStorage(result.book.root,labBookId,vault);
}

// Every owner of a workspace is bound to that workspace's own cluster and keeps
// no cluster of its own. A copy's cluster differs from its source's.
export async function assertOwnersInCluster(workspaceRoot,ownerRoots,{notCluster}={}){
 const home=await catalogueBinding(workspaceRoot);
 if(home?.placement!=='workspace')throw Error('The workspace is not bound to its own cluster');
 if(notCluster!==undefined&&home.cluster===notCluster)throw Error('A copied workspace must have a new cluster');
 for(const root of ownerRoots){
  const binding=await catalogueBinding(root);
  if(!binding||!['project','lab-book'].includes(binding.placement)||binding.cluster!==home.cluster)throw Error('Owner '+root+' is not activated in its workspace cluster');
  if(await assertRegular(path.join(root,'.observanda','postgresql'),{directory:true,missing:true}))throw Error('Owner '+root+' carries a database cluster');
 }
}
