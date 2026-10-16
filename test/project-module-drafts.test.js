import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fixture,calculation} from './project-domain-fixture.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ProjectModuleDrafts} from '../src/project-module-drafts.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {ProjectDraftCatalogue} from '../src/project-draft-catalogue.js';
import {projectModuleDraftContext} from '../src/project-module-draft-context.js';
import {digest,serialize} from '../src/storage-format.js';
import {DRAFT_CHUNK_BYTES} from '../src/web/modules/draft-protocol.js';
const detached=AsyncLocalStorage.snapshot();
function gate(){let enter,release;return {started:new Promise(resolve=>enter=resolve),hold:new Promise(resolve=>release=resolve),enter:()=>enter(),release:()=>release()};}
async function setup(t){const f=await fixture(t);f.commands=new ProjectModuleCommands(f.storage,f.book.id);await f.commands.initialize();f.drafts=new ProjectModuleDrafts(f.storage,f.book.id);return f;}
const descriptor=f=>({format:'observanda-research-catalogue',version:2,workspaceId:f.book.id});
const verify=f=>f.storage.catalogue(store=>store.verify(descriptor(f)));
const draft=(f,command)=>({workspaceId:f.book.id,moduleId:'scientific-calculator',id:randomUUID(),etag:null,drafts:[{id:command.payload.id,type:'calculation',expectedRevision:1,baseRevision:1,data:{...command.payload.data,name:'Unfinished change'}}]});

test('project recovery saves independently of research, command and unrelated editor writers', {timeout:120000},async t=>{
 const f=await setup(t),command=calculation(f);await f.commands.execute(command);const checkpoint=draft(f,command),request={workspaceId:f.book.id,moduleId:checkpoint.moduleId,id:checkpoint.id};
 const research=gate(),busy=detached(()=>f.storage.withLock(async()=>{research.enter();await research.hold;}));await research.started;let saved;
 try{saved=await f.drafts.write(checkpoint);}finally{research.release();await busy;}
 t.mock.method(ModuleCatalogue.prototype,'selected',async()=>{throw Error('Recovery list read a module body');});
 const list=await f.drafts.list({workspaceId:f.book.id,moduleId:checkpoint.moduleId,limit:2});assert.equal(list.drafts.length,1);assert.equal(list.drafts[0].id,checkpoint.id);t.mock.restoreAll();
 const first=await f.drafts.read(request);assert.deepEqual(first.draft.drafts[0].base,command.payload.data);assert.equal(first.draft.drafts[0].data.name,'Unfinished change');
 assert.equal((await f.drafts.write(checkpoint)).etag,saved.etag);
 const writer=gate(),held=detached(()=>f.domains.run(['calculator'],async()=>{writer.enter();await writer.hold;},{write:['calculator']}));await writer.started;
 let changed;try{changed=await f.drafts.write({...checkpoint,etag:saved.etag,drafts:[{...checkpoint.drafts[0],data:{...checkpoint.drafts[0].data,name:'Edited during save'}}]});}finally{writer.release();await held;}
 const authoring=gate(),active=detached(()=>f.domains.run(['calculator'],async()=>{authoring.enter();await authoring.hold;},{authoring:['scientific-calculator']}));await authoring.started;
 try{
  assert.equal((await f.drafts.read(request)).etag,changed.etag);
  const next=await f.commands.execute({...command,commandId:randomUUID(),payload:{...command.payload,expectedRevision:1,data:{...command.payload.data,name:'Saved independently'}}});assert.equal(next.revisions.calculator,2);
  const planning={workspaceId:f.book.id,moduleId:'planning',id:randomUUID(),etag:null,drafts:[{id:randomUUID(),type:'calendar',expectedRevision:null,baseRevision:null,data:{name:'Unfinished calendar'}}]};await f.drafts.write(planning);
 }finally{authoring.release();await active;}
 await assert.rejects(f.drafts.write({...checkpoint,drafts:[{...checkpoint.drafts[0],data:{...checkpoint.drafts[0].data,name:'Stale'}}]}),{code:'DRAFT_CHANGED'});
 assert.deepEqual((await f.drafts.read(request)).draft.drafts[0].base,command.payload.data);
 await f.drafts.write({...checkpoint,etag:changed.etag,drafts:[]});assert.equal((await f.drafts.list({workspaceId:f.book.id,moduleId:checkpoint.moduleId})).drafts.length,0);
 assert.equal((await f.storage.catalogue(async store=>store.db.get("SELECT count(*)::text AS count FROM objects WHERE starts_with(id,'metadata:.observanda/module-draft')"))).count,'0');await verify(f);
});

test('recovery type boundaries and a revoked commit cannot retain partial authoring', {timeout:120000},async t=>{
 const f=await setup(t),command=calculation(f);await f.commands.execute(command);const checkpoint=draft(f,command);
 await assert.rejects(f.drafts.write({...checkpoint,moduleId:'planning'}),{code:'MODULE_FORMAT'});
 let checks=0;await assert.rejects(f.drafts.write(checkpoint,{check:async()=>{if(++checks===2)throw Object.assign(Error('Revoked'),{code:'ACCESS_LOCKED'});}}),{code:'ACCESS_LOCKED'});assert.equal(checks,2);
 assert.equal((await f.drafts.list({workspaceId:f.book.id,moduleId:checkpoint.moduleId})).drafts.length,0);assert.equal(await f.drafts.read({workspaceId:f.book.id,moduleId:checkpoint.moduleId,id:checkpoint.id}),null);
 const saved=await f.drafts.write(checkpoint);assert.ok(saved.etag);
 await assert.rejects(f.drafts.read({workspaceId:randomUUID(),moduleId:checkpoint.moduleId,id:checkpoint.id}),{code:'WORKSPACE_CHANGED'});
 assert.equal(await f.drafts.read({workspaceId:f.book.id,moduleId:'planning',id:checkpoint.id}),null);
});


test('chunked project recovery resumes, rolls back an interrupted finish and detects missing originals', {timeout:180000},async t=>{
 const f=await setup(t),command=calculation(f);await f.commands.execute(command);const checkpoint=draft(f,command);checkpoint.drafts[0].data.expression='Unfinished original '.repeat(250000);
 const bytes=Buffer.from(serialize(checkpoint)),transferHash=digest(bytes),scope={workspaceId:f.book.id,moduleId:checkpoint.moduleId,id:checkpoint.id};
 await f.drafts.start({...scope,baseEtag:null,size:bytes.length,sha256:transferHash});
 const parts=[];for(let offset=0;offset<bytes.length;offset+=DRAFT_CHUNK_BYTES){const part=bytes.subarray(offset,offset+DRAFT_CHUNK_BYTES);parts.push({...scope,transferHash,index:parts.length,sha256:digest(part),bytes:part.toString('base64')});}
 await f.drafts.part(parts[0]);await verify(f);await f.runtime.closeProject(f.storage.root);
 await f.drafts.part(parts[0]);for(const part of parts.slice(1))await f.drafts.part(part);
 const original=ProjectDraftCatalogue.prototype.putObject;t.mock.method(ProjectDraftCatalogue.prototype,'putObject',async function(id,value){if(id.endsWith('/manifest.json')&&JSON.parse(value.text).etag)throw Error('Interrupted receipt write');return original.call(this,id,value);});
 await assert.rejects(f.drafts.finish({...scope,transferHash}),/Interrupted receipt write/);t.mock.restoreAll();assert.equal(await f.drafts.read(scope),null);await verify(f);
 const saved=await f.drafts.finish({...scope,transferHash});assert.deepEqual(await f.drafts.finish({...scope,transferHash}),saved);const recovered=await f.drafts.read(scope);assert.equal(recovered.draft.drafts[0].data.expression,checkpoint.drafts[0].data.expression);assert.deepEqual(recovered.draft.drafts[0].base,command.payload.data);await verify(f);
 await assert.rejects(f.domains.run(['calculator'],async(_get,context)=>{const {store}=await projectModuleDraftContext(context,checkpoint.moduleId,{writable:true});await store.db.run('DELETE FROM state WHERE slot=$1',store.valuePrefix+'metadata:.observanda/module-drafts/'+checkpoint.id+'.json');const {verifyProjectModuleDrafts}=await import('../src/project-module-draft-verification.js');await verifyProjectModuleDrafts(context,'calculator');},{authoring:[checkpoint.moduleId]}),{code:'CATALOGUE_DAMAGED'});
 await verify(f);
});


test('force-terminated recovery reopens without a stale lock and survives archive restoration with fresh keys', {timeout:180000},async t=>{
 let child,exited;t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const f=await setup(t),command=calculation(f);await f.commands.execute(command);const checkpoint=draft(f,command),scope={workspaceId:f.book.id,moduleId:checkpoint.moduleId,id:checkpoint.id};await f.runtime.closeProject(f.storage.root);
 const {spawn}=await import('node:child_process');
 const script=`import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {ProjectStorage} from './src/project-storage.js';import {ProjectModuleDrafts} from './src/project-module-drafts.js';import {ProjectDraftCatalogue} from './src/project-draft-catalogue.js';let raw='';for await(const bytes of process.stdin)raw+=bytes;const input=JSON.parse(raw),vault={id:input.vault.id,key:Buffer.from(input.vault.key,'base64')};const runtime=new WorkspaceDatabases({directory:input.directory,ownerId:input.ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(runtime);const original=ProjectDraftCatalogue.prototype.putObject;ProjectDraftCatalogue.prototype.putObject=async function(id,value){await original.call(this,id,value);if(id.endsWith('/'+input.command.id+'.json')){process.stdout.write('ready');await new Promise(()=>{});}};await new ProjectModuleDrafts(new ProjectStorage(input.root,input.projectId,vault),input.command.workspaceId).write(input.command);`;
 child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Recovery checkpoint timeout: '+errors)),45000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Recovery child exited early: '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.stdin.end(JSON.stringify({directory:f.runtime.directory,ownerId:f.runtime.instances.ownerId,root:f.storage.root,projectId:f.projectId,command:checkpoint,vault:{id:f.vault.id,key:f.vault.key.toString('base64')}}));});
 child.kill('SIGKILL');await exited;await f.runtime.environment(f.storage.root,{projectId:f.projectId,vault:f.vault});assert.equal(await f.drafts.read(scope),null);await verify(f);const saved=await f.drafts.write(checkpoint);
 const {mkdir,copyFile}=await import('node:fs/promises'),path=await import('node:path'),{workspaceFile,atomicWrite}=await import('../src/storage.js'),{backupCatalogue}=await import('../src/postgres.js'),{verifyCatalogueArchive,rekeyCatalogue}=await import('../src/research-catalogue.js'),{ProjectStorage}=await import('../src/project-storage.js');
 const originalDescriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8'),copyRoot=path.join(f.root,'archived');await mkdir(path.join(copyRoot,'.observanda'),{recursive:true});
 for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(copyRoot,file));
 const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,copyRoot,{connection:db});}finally{await db.close();}
 const copied=new ProjectStorage(copyRoot,f.projectId,f.vault);await verifyCatalogueArchive(copied,JSON.parse(originalDescriptor));assert.equal((await new ProjectModuleDrafts(copied,f.book.id).read(scope)).etag,saved.etag);
 const {createWorkspaceAccess,takeCreatedVault}=await import('../src/access.js'),{TestDeviceStore}=await import('./device-fixture.js'),{clearVault}=await import('../src/encryption.js');
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'new-device')})),vault=takeCreatedVault(access);
 try{const target=new ProjectStorage(path.join(f.root,'rekeyed'),f.projectId,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),originalDescriptor);
  await rekeyCatalogue(f.storage,target,JSON.parse(originalDescriptor));await verifyCatalogueArchive(target,JSON.parse(originalDescriptor));const recovered=await new ProjectModuleDrafts(target,f.book.id).read(scope);assert.equal(recovered.etag,saved.etag);assert.deepEqual(recovered.draft.drafts[0].base,command.payload.data);
 }finally{clearVault(vault);}
 await verify(f);
});
