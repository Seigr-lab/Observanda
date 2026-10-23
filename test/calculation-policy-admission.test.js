import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fixture,calculation} from './project-domain-fixture.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ProjectModuleDrafts} from '../src/project-module-drafts.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {catalogueFormat,catalogueRequiresCalculationPolicies,catalogueRequiresDomains} from '../src/catalogue-format.js';
import {verifiedCatalogueObjects} from '../src/catalogue-object-verification.js';
import {serialize} from '../src/storage-format.js';
import {defaultCalculationPolicy} from '../src/web/tools/calculation-policy.js';

const detached=AsyncLocalStorage.snapshot();
const policyCommand=f=>{const command=calculation(f);command.payload.data={...command.payload.data,engine:3,policy:defaultCalculationPolicy()};return command;};
const format=f=>f.storage.catalogue(store=>catalogueFormat(store.db));
async function heldDomain(f,options,operation){
 let entered,release,expired=false;
 const started=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const held=detached(()=>f.domains.run(['calculator'],async(_get,{research})=>{
  await catalogueFormat(research.db);entered();await hold;
 },options));
 const timer=setTimeout(()=>{expired=true;release();},10000);
 try{
  await Promise.race([started,held.then(()=>{throw Error('Held owner ended before admission');})]);
  await operation();assert.equal(expired,false,'Admission must finish while the other owner still holds its transaction');
 }finally{clearTimeout(timer);release();await held;}
}
function revokeBeforeCommit(){
 let calls=0;return {check:async()=>{if(++calls===2)throw Object.assign(Error('Revoked before commit'),{code:'ACCESS_LOCKED'});},calls:()=>calls};
}

test('first calculation policy admission refuses conflicting domain readers atomically and preserves independent writes after retry',{timeout:120000},async t=>{
 const f=await fixture(t),commands=new ProjectModuleCommands(f.storage,f.book.id),drafts=new ProjectModuleDrafts(f.storage,f.book.id);
 const command=policyCommand(f),draftCommand=policyCommand(f);
 const checkpoint={workspaceId:f.book.id,moduleId:'scientific-calculator',id:randomUUID(),etag:null,drafts:[{id:draftCommand.payload.id,type:'calculation',expectedRevision:null,baseRevision:null,data:draftCommand.payload.data}]};
 const scope={workspaceId:f.book.id,moduleId:checkpoint.moduleId,id:checkpoint.id};
 // Raw restored metadata must be rejected even without a ModuleDrafts read,
 // using the parent format for domain stores and the local format otherwise.
 const copiedCheckpoint='metadata:.observanda/module-drafts/'+checkpoint.id+'.json';
 const verifyCopied=async store=>{
  await store.putObject(copiedCheckpoint,{text:serialize({...checkpoint,formatVersion:2,updatedAt:new Date().toISOString()})});
  for await(const object of verifiedCatalogueObjects(store))void object;
 };
 await assert.rejects(f.storage.withLock(()=>f.storage.catalogue(verifyCopied)),{code:'CATALOGUE_DAMAGED'});
 await commands.initialize();const before=await format(f);
 assert.equal(catalogueRequiresCalculationPolicies(before),false);
 const empty=async()=>{
  assert.equal(await format(f),before);
  await f.domains.run(['calculator'],async get=>{const catalogue=new ModuleCatalogue(get('calculator')),head=await catalogue.head(f.book.id);assert.equal(head.revision,0);assert.equal(await catalogue.selected(head,command.payload.id),null);});
  assert.equal(await drafts.read(scope),null);
  assert.equal((await drafts.list({workspaceId:f.book.id,moduleId:checkpoint.moduleId})).drafts.length,0);
 };
 await assert.rejects(f.domains.run(['calculator'],get=>verifyCopied(get('calculator')),{write:['calculator']}),{code:'CATALOGUE_DAMAGED'});
 assert.equal(await f.storage.catalogue(store=>store.object(copiedCheckpoint)),null);
 await f.domains.run(['calculator'],async get=>assert.equal(await get('calculator').object(copiedCheckpoint),null));
 await empty();
 // Command and checkpoint locks differ, but both transactions read the parent
 // format. Neither first upgrade may wait while retaining that shared read.
 await heldDomain(f,{authoring:[checkpoint.moduleId]},()=>assert.rejects(commands.execute(command),{code:'LOCKED'}));
 await empty();
 await heldDomain(f,{write:['calculator']},()=>assert.rejects(drafts.write(checkpoint),{code:'LOCKED'}));
 await empty();
 // Revocation after the callback rolls back both the new format and its data.
 for(const save of [options=>commands.execute(command,options),options=>drafts.write(checkpoint,options)]){
  const revoked=revokeBeforeCommit();await assert.rejects(save({check:revoked.check}),{code:'ACCESS_LOCKED'});assert.equal(revoked.calls(),2);await empty();
 }
 const saved=await commands.execute(command);assert.equal(saved.revisions.calculator,1);assert.deepEqual(saved.entities[0].data,command.payload.data);
 assert.equal((await commands.execute(command)).replayed,true);
 const admitted=await format(f);assert.equal(catalogueRequiresCalculationPolicies(admitted),true);assert.equal(catalogueRequiresDomains(admitted),true);
 const checkpointResult=await drafts.write(checkpoint);assert.equal((await drafts.write(checkpoint)).etag,checkpointResult.etag);
 assert.deepEqual((await drafts.read(scope)).draft.drafts[0].data,checkpoint.drafts[0].data);
 // Once admitted, ordinary policy saves retain the existing independent
 // command/authoring locks and do not take a parent-table exclusive lock.
 const next={...command,commandId:randomUUID(),payload:{...command.payload,expectedRevision:1,data:{...command.payload.data,name:'Saved while authoring is active'}}};
 await heldDomain(f,{authoring:[checkpoint.moduleId]},async()=>assert.equal((await commands.execute(next)).revisions.calculator,2));
 const changed={...checkpoint,etag:checkpointResult.etag,drafts:[{...checkpoint.drafts[0],data:{...checkpoint.drafts[0].data,name:'Checkpoint while command is active'}}]};
 let changedResult;await heldDomain(f,{write:['calculator']},async()=>{changedResult=await drafts.write(changed);});
 assert.equal((await drafts.write(changed)).etag,changedResult.etag);assert.equal(await format(f),admitted);
 await f.storage.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:f.book.id}));
});
