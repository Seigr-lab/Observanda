import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {copyProjectOwnerLocation,projectTransferReceipt} from '../src/project-transfer.js';
import {assertInventoryObligationsSettled} from '../src/inventory-obligation-lifecycle.js';
import {fixture} from './project-domain-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
import {initializeProjectLocation,ProjectStorage} from '../src/project-storage.js';
import {ProjectDomains} from '../src/project-domains.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {blankBOM,bomLine} from '../src/web/modules/bom-model.js';
import {hasInventoryObligations,InventoryOperationStore} from '../src/inventory-operation-store.js';
import {inventoryOperationStatus,executeInventoryOperation,resumeInventoryOperation,abortInventoryOperation} from '../src/inventory-operation-coordinator.js';
import {AppError} from '../src/errors.js';
const cmd=(f,action,payload,commandId=randomUUID())=>({workspaceId:f.book.id,commandId,action,payload});
async function setup(t){
 const f=await fixture(t),book=sampleNotebook();book.title=book.projects[0].title='Stock owner';
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'source-device')})),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const storage=await initializeProjectLocation(path.join(f.root,'Stock owner'),book.projects[0].id,book,access,vault),source={book,storage,vault,projectId:book.projects[0].id,domains:new ProjectDomains(storage,book.id)};
 f.commands=new ProjectModuleCommands(f.storage,f.book.id);source.commands=new ProjectModuleCommands(storage,book.id);await f.commands.initialize();await source.commands.initialize();
 const owners=new Map([[f.book.id,f],[source.book.id,source]]),grants=new Map([...owners.keys()].map(id=>[id,{}]));
 f.inventorySourceAccess=async()=>{const captured=new Map();const check=id=>{if(!grants.has(id)||captured.has(id)&&captured.get(id)!==grants.get(id))throw new AppError('ACCESS_LOCKED');};return {async useOwner(id,consume){check(id);captured.set(id,grants.get(id));return consume(owners.get(id).storage,{workspaceId:id},{check:async()=>check(id)});},verify:async()=>{for(const id of captured.keys())check(id);},close:async()=>{captured.clear();}};};
 return {f,source,grants};
}
const get=(f,domain,id)=>f.domains.run([domain],async access=>{const catalogue=new ModuleCatalogue(access(domain));return catalogue.selected(await catalogue.head(f.book.id),id);});
async function resource(f,id,quantity='10'){await f.commands.execute(cmd(f,'resource.create',{id,data:{projectId:null,placementId:null,name:'Test material',code:id,kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]},openingStock:{quantity,projectId:null}}));}
const obligations=(f,domain)=>f.domains.run([domain],access=>hasInventoryObligations(access(domain)));

test('mixed-owner BOM reserves, records use and scrap, replays exact receipts and retains independent owner ledgers',{timeout:120000},async t=>{
 const {f,source,grants}=await setup(t),resourceId=randomUUID(),bomId=randomUUID();await resource(f,resourceId);await resource(source,resourceId);
 const foreign={workspaceId:source.book.id,type:'resource',id:resourceId},lines=[{...bomLine(),value:'Local part',resourceId,quantity:'2'},{...bomLine(),value:'Foreign part',resourceId:foreign,quantity:'3'}],options={inventorySourceAccess:f.inventorySourceAccess};
 const saved=await f.commands.execute(cmd(f,'bom.save',{id:bomId,expectedRevision:null,data:{...blankBOM(),title:'Mixed build',recordId:f.book.entries[0].id,lines}}),options);assert.equal(saved.entities[0].revision,1);
 const reserve=cmd(f,'bom.reserve',{id:bomId,expectedRevision:1,resources:[{id:resourceId,revision:1},{id:foreign,revision:1}]}),reserved=await f.commands.execute(reserve,options);
 assert.equal(reserved.operationPending,undefined,JSON.stringify(reserved.operation));const bom=reserved.entities.find(e=>e.id===bomId);assert.equal(bom.data.status,'reserved');assert.equal(bom.data.externalStock.reservation.receipts.length,2);
 assert.equal(await obligations(f,'bom'),true);assert.equal(await obligations(source,'inventory'),true);
 for(const allocation of bom.data.allocations){const owner=allocation.workspaceId===f.book.id?f:source,reservation=await get(owner,'inventory',allocation.reservationId);assert.equal(reservation.data.managed.bom.workspaceId,f.book.id);assert.equal(reservation.data.status,'active');await assert.rejects(owner.commands.execute(cmd(owner,'stock.resolve',{id:reservation.id,expectedRevision:reservation.revision,consume:false})));}
 const usage=lines.map((line,index)=>({lineId:line.id,used:index?'1':'2',scrapped:index?'1':'0'})),finish=cmd(f,'bom.finish',{id:bomId,expectedRevision:2,usage}),finished=await f.commands.execute(finish,options);
 assert.equal(finished.operationPending,undefined,JSON.stringify(finished.operation));assert.equal(finished.entities[0].data.status,'finished');assert.equal(await obligations(f,'bom'),false);assert.equal(await obligations(source,'inventory'),false);
 grants.delete(source.book.id);const replay=await f.commands.execute(finish,options);assert.equal(replay.replayed,true);assert.equal(replay.entities[0].revision,3);await assert.rejects(f.commands.execute({...finish,payload:{...finish.payload,usage:[]}},options),{code:'MODULE_REPLAY'});
 const oldReserve=await f.commands.execute(reserve,options);assert.equal(oldReserve.replayed,true);assert.equal(oldReserve.entities[0].data.status,'finished');assert.equal(await obligations(f,'bom'),false);await assertInventoryObligationsSettled(f.storage);
 assert.equal((await inventoryOperationStatus(f.storage,f.book.id,{bomId})).operation.phase,'complete');
 for(const owner of [f,source])await owner.storage.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:owner.book.id}));
});

const verify=owner=>owner.storage.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:owner.book.id}));
async function mixed(f,source,resourceId,{quantity='1'}={}){
 const bomId=randomUUID(),foreign={workspaceId:source.book.id,type:'resource',id:resourceId},lines=[{...bomLine(),value:'Local part',resourceId,quantity},{...bomLine(),value:'Foreign part',resourceId:foreign,quantity}],options={inventorySourceAccess:f.inventorySourceAccess};
 await f.commands.execute(cmd(f,'bom.save',{id:bomId,expectedRevision:null,data:{...blankBOM(),title:'Recovery build',recordId:f.book.entries[0].id,lines}}),options);
 const resources=[];for(const [owner,id] of [[f,resourceId],[source,foreign]])resources.push({id,revision:(await get(owner,'inventory',resourceId)).revision});
 return {bomId,lines,options,reserve:cmd(f,'bom.reserve',{id:bomId,expectedRevision:1,resources})};
}

test('each committed inventory boundary resumes without duplicated source effects, and completed copies verify without sources',{timeout:240000},async t=>{
 const {f,source}=await setup(t),resourceId=randomUUID();await resource(f,resourceId,'100');await resource(source,resourceId,'100');
 for(const stage of ['intent','source-prepared','prepared','decision','source-applied','applied','complete']){
  const {bomId,reserve,options}=await mixed(f,source,resourceId),fault=new DOMException('Interrupted after durable checkpoint','AbortError');let stopped=false;
  await assert.rejects(executeInventoryOperation(f.storage,f.book.id,reserve,{sourceAccess:f.inventorySourceAccess,checkpoint:async name=>{if(name===stage&&!stopped){stopped=true;throw fault;}}}),error=>error===fault);assert.equal(stopped,true,stage);
  await verify(f);await verify(source);
  const state=(await inventoryOperationStatus(f.storage,f.book.id,{id:reserve.commandId})).operation;assert.equal(state.terminal,stage==='complete');
  if(!state.terminal)await assert.rejects(assertInventoryObligationsSettled(f.storage),{code:'INVENTORY_OBLIGATIONS'});
  const resumed=await resumeInventoryOperation(f.storage,f.book.id,{id:reserve.commandId},{sourceAccess:f.inventorySourceAccess});assert.equal(resumed.operationPending,undefined);assert.equal(resumed.entities[0].data.status,'reserved');
  for(const allocation of resumed.entities[0].data.allocations){const owner=allocation.workspaceId===f.book.id?f:source;assert.equal((await get(owner,'inventory',allocation.reservationId)).revision,1);}
  const cancel=await f.commands.execute(cmd(f,'bom.cancel',{id:bomId,expectedRevision:2}),options);assert.equal(cancel.entities[0].data.status,'cancelled');await verify(f);await verify(source);
 }
 await assertInventoryObligationsSettled(f.storage);await assertInventoryObligationsSettled(source.storage);
 const parent=path.join(f.root,'settled-copy');await mkdir(parent);const copied=await copyProjectOwnerLocation(f.storage,path.join(parent,'project'),{id:randomUUID()});
 try{await copied.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:f.book.id}));}finally{await f.runtime.closeProject(copied.root);}
});

test('pending compensation retains obligations until the original source is authorized, while exact concurrent retry does not over-reserve',{timeout:150000},async t=>{
 const {f,source,grants}=await setup(t),resourceId=randomUUID();await resource(f,resourceId,'10');await resource(source,resourceId,'10');
 const {bomId,reserve,options}=await mixed(f,source,resourceId),fault=new DOMException('Interrupted source acknowledgement','AbortError');let stopped=false;
 await assert.rejects(executeInventoryOperation(f.storage,f.book.id,reserve,{sourceAccess:f.inventorySourceAccess,checkpoint:async(name,details)=>{if(name==='source-prepared'&&details.workspaceId===source.book.id&&!stopped){stopped=true;throw fault;}}}),error=>error===fault);
 const grant=grants.get(source.book.id);grants.delete(source.book.id);
 const abort=await abortInventoryOperation(f.storage,f.book.id,{id:reserve.commandId},{sourceAccess:f.inventorySourceAccess});assert.equal(abort.operationPending,true);assert.equal(abort.operation.decision,'abort');assert.equal(abort.operation.error.code,'ACCESS_LOCKED');
 await verify(f);await verify(source);assert.equal(await obligations(f,'bom'),true);assert.equal(await obligations(source,'inventory'),true);
 await assert.rejects(f.commands.execute(cmd(f,'bom.save',{id:bomId,expectedRevision:1,data:(await get(f,'bom',bomId)).data}),options),{code:'INVENTORY_OPERATION_BUSY'});
 grants.set(source.book.id,grant);const resumed=await resumeInventoryOperation(f.storage,f.book.id,{id:reserve.commandId},{sourceAccess:f.inventorySourceAccess});assert.equal(resumed.operationPending,false);assert.equal(resumed.operation.phase,'aborted');assert.equal((await get(f,'bom',bomId)).data.status,'draft');await verify(f);await verify(source);
 const next=await mixed(f,source,resourceId),attempts=await Promise.allSettled([f.commands.execute(next.reserve,options),f.commands.execute(next.reserve,options)]),results=attempts.filter(r=>r.status==='fulfilled').map(r=>r.value);assert.ok(results.length);for(const attempt of attempts)if(attempt.status==='rejected')assert.equal(attempt.reason.code,'LOCKED');for(const result of results){assert.equal(result.operationPending,undefined,JSON.stringify(result.operation));assert.equal(result.entities[0].data.status,'reserved');}const replay=await f.commands.execute(next.reserve,options);assert.equal(replay.replayed,true);
 for(const allocation of results[0].entities[0].data.allocations){const owner=allocation.workspaceId===f.book.id?f:source;assert.equal((await get(owner,'inventory',allocation.reservationId)).revision,1);}
 await f.commands.execute(cmd(f,'bom.cancel',{id:next.bomId,expectedRevision:2}),options);await verify(f);await verify(source);
});

test('inventory recovery rejects replaced original-event evidence and missing live reservation markers',{timeout:120000},async t=>{
 const {f,source}=await setup(t),resourceId=randomUUID();await resource(f,resourceId);await resource(source,resourceId);const {reserve,options}=await mixed(f,source,resourceId);await f.commands.execute(reserve,options);await verify(source);
 const change=fn=>source.domains.run(['inventory'],get=>fn(get('inventory'),new InventoryOperationStore(get('inventory'))),{write:['inventory']});
 const original=await change(async(_store,journal)=>journal.read('receipt',reserve.commandId));
 await change((store,journal)=>store.putObject(journal.key('receipt',reserve.commandId),{...original,value:{...original.value,event:{...original.value.event,hash:'0'.repeat(64)}}}));
 await assert.rejects(verify(source),{code:'CATALOGUE_DAMAGED'});await change((store,journal)=>store.putObject(journal.key('receipt',reserve.commandId),original));
 const reservationId=original.value.lines[0].reservationId,live=await change((_store,journal)=>journal.read('live',reservationId));await change((_store,journal)=>journal.remove('live',reservationId));await assert.rejects(verify(source),{code:'CATALOGUE_DAMAGED'});await change((_store,journal)=>journal.write('live',reservationId,live));await verify(source);
});
test('same-owner addressed material reserves locally and committed draft replay never reopens a replaced source',{timeout:120000},async t=>{
 const {f,source,grants}=await setup(t),resourceId=randomUUID();await resource(f,resourceId);await resource(source,resourceId);
 const bomId=randomUUID(),line={...bomLine(),value:'Addressed local material',resourceId:{workspaceId:f.book.id,type:'resource',id:resourceId}},localData={...blankBOM(),title:'Local addressed build',recordId:f.book.entries[0].id,lines:[line]};
 await f.commands.execute(cmd(f,'bom.save',{id:bomId,expectedRevision:null,data:localData}));const reserved=await f.commands.execute(cmd(f,'bom.reserve',{id:bomId,expectedRevision:1,resources:[{id:line.resourceId,revision:1}]}));assert.equal(reserved.entities[0].data.status,'reserved');await f.commands.execute(cmd(f,'bom.cancel',{id:bomId,expectedRevision:2}));
 const draftId=randomUUID(),foreignData={...localData,lines:[{...line,resourceId:{workspaceId:source.book.id,type:'resource',id:resourceId}}]},save=cmd(f,'bom.save',{id:draftId,expectedRevision:null,data:foreignData}),options={inventorySourceAccess:f.inventorySourceAccess};await f.commands.execute(save,options);await f.commands.execute(cmd(f,'bom.save',{id:draftId,expectedRevision:1,data:localData}),options);grants.delete(source.book.id);
 const replay=await f.commands.execute(save,options);assert.equal(replay.replayed,true);assert.equal(replay.entities[0].revision,2);assert.equal(replay.entities[0].data.lines[0].resourceId.workspaceId,f.book.id);await verify(f);
});

test('revocation before a durable decision cannot commit, and a lost settlement acknowledgement never duplicates usage',{timeout:150000},async t=>{
 const {f,source,grants}=await setup(t),resourceId=randomUUID();await resource(f,resourceId);await resource(source,resourceId);const {bomId,reserve,lines,options}=await mixed(f,source,resourceId),grant=grants.get(source.book.id);
 const pending=await executeInventoryOperation(f.storage,f.book.id,reserve,{sourceAccess:f.inventorySourceAccess,checkpoint:async(name,detail)=>{if(name==='prepared'&&detail.workspaceId===source.book.id)grants.delete(source.book.id);}});assert.equal(pending.operationPending,true);assert.equal(pending.operation.decision,null);assert.equal(pending.operation.error.code,'ACCESS_LOCKED');assert.equal((await get(f,'bom',bomId)).data.status,'draft');await verify(f);await verify(source);
 grants.set(source.book.id,grant);await resumeInventoryOperation(f.storage,f.book.id,{id:reserve.commandId},{sourceAccess:f.inventorySourceAccess});
 const finish=cmd(f,'bom.finish',{id:bomId,expectedRevision:2,usage:lines.map(line=>({lineId:line.id,used:'0.5',scrapped:'0.25'}))}),fault=new DOMException('Lost settlement acknowledgement','AbortError');let stopped=false;
 await assert.rejects(executeInventoryOperation(f.storage,f.book.id,finish,{sourceAccess:f.inventorySourceAccess,checkpoint:async(name,details)=>{if(name==='source-applied'&&details.workspaceId===source.book.id&&!stopped){stopped=true;throw fault;}}}),error=>error===fault);await verify(f);await verify(source);
 grants.delete(source.book.id);await assert.rejects(abortInventoryOperation(f.storage,f.book.id,{id:finish.commandId},{sourceAccess:f.inventorySourceAccess}),{code:'INVENTORY_OPERATION_BUSY'});const blocked=await resumeInventoryOperation(f.storage,f.book.id,{id:finish.commandId},{sourceAccess:f.inventorySourceAccess});assert.equal(blocked.operationPending,true);assert.equal(blocked.operation.decision,'commit');
 grants.set(source.book.id,grant);const completed=await f.commands.execute(finish,options);assert.equal(completed.entities[0].data.status,'finished');for(const allocation of completed.entities[0].data.allocations){const owner=allocation.workspaceId===f.book.id?f:source,held=await get(owner,'inventory',allocation.reservationId);assert.equal(held.revision,2);assert.deepEqual([held.data.managed.settlement.used,held.data.managed.settlement.scrapped],['0.5','0.25']);}await verify(f);await verify(source);
});

test('a force-terminated inventory coordinator resumes the committed original source hold after process restart',{timeout:150000},async t=>{
 const {f,source}=await setup(t),resourceId=randomUUID();await resource(f,resourceId);await resource(source,resourceId);const {bomId,reserve,options}=await mixed(f,source,resourceId);
 await f.runtime.closeProject(f.storage.root);await f.runtime.closeProject(source.storage.root);const {spawn}=await import('node:child_process');let child,exited;
 const script=`import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {ProjectStorage} from './src/project-storage.js';import {executeInventoryOperation} from './src/inventory-operation-coordinator.js';let raw='';for await(const bytes of process.stdin)raw+=bytes;const input=JSON.parse(raw),runtime=new WorkspaceDatabases({directory:input.directory,ownerId:input.ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(runtime);const owners=new Map(input.owners.map(v=>[v.namespace,new ProjectStorage(v.root,v.projectId,{id:v.vault.id,key:Buffer.from(v.vault.key,'base64')})]));const sourceAccess=async()=>({useOwner:async(id,consume)=>consume(owners.get(id),{workspaceId:id},{check:async()=>{}}),verify:async()=>{},close:async()=>{}});await executeInventoryOperation(owners.get(input.command.workspaceId),input.command.workspaceId,input.command,{sourceAccess,checkpoint:async(stage,detail)=>{if(stage==='source-prepared'&&detail.workspaceId===input.source){process.stdout.write('durable-source-hold');await new Promise(()=>{});}}});`;
 try{
  child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Inventory checkpoint timeout: '+errors)),60000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Inventory child exited before checkpoint: '+errors));});child.stdout.once('data',bytes=>{clearTimeout(timer);assert.equal(bytes.toString(),'durable-source-hold');resolve();});child.stdin.end(JSON.stringify({directory:f.runtime.directory,ownerId:f.runtime.instances.ownerId,command:reserve,source:source.book.id,owners:[f,source].map(owner=>({namespace:owner.book.id,root:owner.storage.root,projectId:owner.projectId,vault:{id:owner.vault.id,key:owner.vault.key.toString('base64')}}))}));});
  child.kill('SIGKILL');await exited;
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}for(const owner of [f,source])await f.runtime.environment(owner.storage.root,{projectId:owner.projectId,vault:owner.vault});}
 await verify(f);await verify(source);const result=await f.commands.execute(reserve,options);assert.equal(result.entities[0].data.status,'reserved');for(const allocation of result.entities[0].data.allocations){const owner=allocation.workspaceId===f.book.id?f:source;assert.equal((await get(owner,'inventory',allocation.reservationId)).revision,1);}await f.commands.execute(cmd(f,'bom.cancel',{id:bomId,expectedRevision:2}),options);await verify(f);await verify(source);
});
test('insufficient later-owner stock aborts earlier holds without consuming stock or acknowledging a reserved BOM',{timeout:120000},async t=>{
 const {f,source}=await setup(t),resourceId=randomUUID(),ordered=[f,source].sort((a,b)=>a.book.id.localeCompare(b.book.id));await resource(ordered[0],resourceId,'10');await resource(ordered[1],resourceId,'1');
 const first=await mixed(f,source,resourceId,{quantity:'2'}),result=await f.commands.execute(first.reserve,first.options);assert.equal(result.operationPending,false);assert.equal(result.operation.phase,'aborted');assert.equal(result.operation.error.code,'STOCK_UNAVAILABLE');assert.equal((await get(f,'bom',first.bomId)).data.status,'draft');
 for(const owner of [f,source]){assert.equal(await obligations(owner,'inventory'),false);await verify(owner);}assert.equal(await obligations(f,'bom'),false);
 const next=await mixed(f,source,resourceId),reserved=await f.commands.execute(next.reserve,next.options);assert.equal(reserved.entities[0].data.status,'reserved');await f.commands.execute(cmd(f,'bom.cancel',{id:next.bomId,expectedRevision:2}),next.options);await verify(f);await verify(source);
});

test('an interrupted relocation target with live stock cannot be published as an ordinary copy after source settlement',{timeout:150000},async t=>{
 const {f,source}=await setup(t),resourceId=randomUUID();await resource(f,resourceId);await resource(source,resourceId);const {bomId,reserve,options}=await mixed(f,source,resourceId);await f.commands.execute(reserve,options);
 const parent=path.join(f.root,'interrupted-relocation');await mkdir(parent);const destination=path.join(parent,'project'),id=randomUUID(),fault=new Error('Stopped before relocation publication');let verified=false;
 await assert.rejects(copyProjectOwnerLocation(f.storage,destination,{id,relocation:true,checkpoint:async stage=>{if(stage==='verified'){verified=true;throw fault;}}}),error=>error===fault);assert.equal(verified,true);
 const target=new ProjectStorage(destination,f.projectId,f.vault),copied={storage:target,book:f.book,domains:new ProjectDomains(target,f.book.id)},marker=path.join(destination,'.observanda','copy-in-progress');
 const receipt=await projectTransferReceipt(target),retainedBOM=await get(copied,'bom',bomId);assert.equal(receipt.phase,'verified');assert.equal(receipt.relocation,true);assert.match(await readFile(marker,'utf8'),/copying project/);assert.equal((await get(copied,'bom',bomId)).data.status,'reserved');assert.equal(await obligations(copied,'bom'),true);
 await f.commands.execute(cmd(f,'bom.cancel',{id:bomId,expectedRevision:2}),options);await assertInventoryObligationsSettled(f.storage);await assertInventoryObligationsSettled(source.storage);
 for(const retainIncomplete of [false,true]){let published=false;await assert.rejects(copyProjectOwnerLocation(f.storage,destination,{id,retainIncomplete,onVerified:async()=>{published=true;}}),{code:'CONFLICT'});assert.equal(published,false);assert.match(await readFile(marker,'utf8'),/copying project/);assert.equal(await obligations(copied,'bom'),true);}
 const resumed=await copyProjectOwnerLocation(f.storage,destination,{id,relocation:true,retainIncomplete:true,checkpoint:async()=>assert.fail('Verified relocation retry must not copy again')});assert.equal(resumed.root,target.root);assert.deepEqual(await projectTransferReceipt(target),receipt);assert.deepEqual(await get(copied,'bom',bomId),retainedBOM);
 assert.match(await readFile(marker,'utf8'),/copying project/);assert.equal((await projectTransferReceipt(target)).phase,'verified');assert.equal((await get(copied,'bom',bomId)).data.status,'reserved');assert.equal(await obligations(copied,'bom'),true);await verify(copied);
});
