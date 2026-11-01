import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {withCatalogueFormatRead,catalogueReadToken} from '../src/catalogue-format-read.js';
import {catalogueContext,withCatalogueCacheBoundary} from '../src/catalogue-context.js';
import {CatalogueReadCache} from '../src/catalogue-read-cache.js';
import {withRetiredProjectRecords,withRetiredProjectCatalogue} from '../src/project-retired-records.js';
import {digest} from '../src/storage-format.js';
function fixture(){
 const receipt={version:1,operationId:randomUUID(),projectId:randomUUID(),sourceNamespace:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),sourceHead:digest('source')},counts={authority:0,source:0,target:0,adoption:0,grants:0},cache=new CatalogueReadCache(),targetCache=new CatalogueReadCache();
 const workspace={root:'synthetic-root',vault:{id:randomUUID(),key:randomBytes(32)}},storage={projectId:receipt.projectId,vault:{id:receipt.vaultId,key:randomBytes(32)}};
 const source={workspace,readCache:cache,db:{schema:'synthetic_source',get:async()=>{counts.authority++;return {payload:Buffer.from(JSON.stringify(receipt))};}},decode:(_kind,_key,payload)=>JSON.parse(payload),snapshot:async()=>{counts.source++;return {metadata:{id:receipt.sourceNamespace}};}};
 const target={workspace:storage,readCache:targetCache,db:{schema:'synthetic_target'},snapshot:async()=>{counts.target++;return {metadata:{id:receipt.namespaceId}};},object:async()=>{counts.adoption++;return {version:1,ready:true,receipt};}};let sourceScope,targetScope,allowed=true;
 storage.catalogue=operation=>targetScope?targetScope.run(()=>operation(target)):operation(target);
 const router={registry:{workspace},withProject:async(id,operation)=>{counts.grants++;assert.equal(id,receipt.projectId);if(!allowed)throw Object.assign(Error('Revoked'),{code:'ACCESS_LOCKED'});return operation(storage);}};
 const use=(value=receipt)=>withRetiredProjectCatalogue(source,value,{kind:'project',id:receipt.projectId},async selected=>{assert.equal(selected,target);return true;});
 return {receipt,counts,cache,targetCache,source,target,storage,use,revoke:()=>allowed=false,authorized:operation=>withRetiredProjectRecords(workspace,router,operation),scoped:operation=>withCatalogueFormatRead(source.db,left=>{sourceScope=left;return withCatalogueFormatRead(target.db,right=>{targetScope=right;return sourceScope.run(operation);});})};
}
test('immutable read tokens reject closed/schema scopes and change across commit boundaries',async()=>{
 const db={schema:'scope_one'},other={schema:'scope_one'};let saved,token;
 await withCatalogueFormatRead(db,async scope=>{saved=scope;token=catalogueReadToken(db);assert.ok(token);assert.equal(catalogueReadToken(db),token);assert.equal(catalogueReadToken(other),null);
  await withCatalogueCacheBoundary({db},async()=>assert.equal(catalogueReadToken(db),null));assert.notEqual(catalogueReadToken(db),token);
  db.schema='scope_two';assert.equal(catalogueReadToken(db),null);assert.throws(()=>scope.run(()=>{}),{code:'INVALID'});db.schema='scope_one';
 });assert.equal(catalogueReadToken(db),null);assert.throws(()=>saved.run(()=>{}),{code:'INVALID'});
 await withCatalogueFormatRead(db,async()=>assert.notEqual(catalogueReadToken(db),token));
});
test('retired owner controls reuse one immutable proof while every grant is checked',async()=>{
 const f=fixture();try{await f.authorized(()=>f.scoped(async()=>{
  for(let i=0;i<64;i++)assert.equal(await f.use(),true);
  assert.deepEqual(f.counts,{authority:1,source:1,target:1,adoption:1,grants:64});
  const originalVault=f.storage.vault.id;f.storage.vault.id=randomUUID();await assert.rejects(f.use(),{code:'CATALOGUE_DAMAGED'});f.storage.vault.id=originalVault;
  f.revoke();await assert.rejects(f.use(),{code:'ACCESS_LOCKED'});assert.equal(f.counts.grants,66);
 }));}finally{f.cache.clear();f.targetCache.clear();}
});
test('writer scopes and new transactions cannot reuse retired authority or adoption proofs',async()=>{
 const f=fixture();try{
  await f.authorized(()=>f.scoped(async()=>{await f.use();await catalogueContext.run({db:f.source.db},async()=>{await f.use();await f.use();});assert.equal(f.counts.authority,3);assert.equal(f.counts.adoption,3);
   await assert.rejects(f.use({...f.receipt,sourceHead:digest('changed receipt')}),{code:'CATALOGUE_DAMAGED'});
   f.source.workspace.vault.key=randomBytes(32);await f.use();assert.equal(f.counts.authority,5);
  }));
  f.target.object=async()=>({version:1,ready:false,receipt:f.receipt});await f.authorized(()=>f.scoped(()=>assert.rejects(f.use(),{code:'CATALOGUE_DAMAGED'})));
  f.target.object=async()=>({version:1,ready:true,receipt:f.receipt});f.target.snapshot=async()=>({metadata:{id:randomUUID()}});await f.authorized(()=>f.scoped(()=>assert.rejects(f.use(),{code:'CATALOGUE_DAMAGED'})));
  f.source.snapshot=async()=>({metadata:{id:randomUUID()}});await f.authorized(()=>f.scoped(()=>assert.rejects(f.use(),{code:'CATALOGUE_DAMAGED'})));
 }finally{f.cache.clear();f.targetCache.clear();}
});
