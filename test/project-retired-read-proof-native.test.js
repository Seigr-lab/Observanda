import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retiredProjectProofFixture} from './retired-project-proof-fixture.js';
import {withCatalogueFormatRead} from '../src/catalogue-format-read.js';
import {withCatalogueCacheBoundary} from '../src/catalogue-context.js';
import {withRetiredProjectRecords} from '../src/project-retired-records.js';
import {retainedMetadataSlot} from '../src/project-retired-metadata.js';

test('native adopted metadata proves every payload with one immutable owner control check',async t=>{
 const f=await retiredProjectProofFixture(t),runs=[];let allowed=true;
 const read=async cached=>f.source.catalogue(source=>f.project.catalogue(target=>withCatalogueFormatRead(source.db,left=>withCatalogueFormatRead(target.db,right=>{
  const counters={sourceSnapshots:0,targetSnapshots:0,authority:0,adoption:0,payloads:0,grants:0,queries:0},restore=[];
  for(const [store,label] of [[source,'source'],[target,'target']]){
   const decode=store.decode;store.decode=function(kind,id,...args){if(kind==='snapshot')counters[label+'Snapshots']++;if(id==='project-source-authority:project:'+f.receipt.projectId)counters.authority++;if(kind==='object'&&id==='project:adoption')counters.adoption++;if(kind==='state'&&id.startsWith('project-source-metadata:payload:'))counters.payloads++;return decode.call(this,kind,id,...args);};restore.push(()=>store.decode=decode);
   const query=store.db.client.query;store.db.client.query=function(...args){counters.queries++;return query.apply(this,args);};restore.push(()=>store.db.client.query=query);
  }
  const facade=Object.create(f.project);facade.catalogue=operation=>right.run(()=>f.project.inspectCatalogue(target,()=>operation(target)));
  const router={registry:{workspace:f.source},withProject:async(id,operation)=>{assert.equal(id,f.receipt.projectId);counters.grants++;if(!allowed)throw Object.assign(Error('Revoked'),{code:'ACCESS_LOCKED'});return operation(facade);}};
  const run=()=>withRetiredProjectRecords(f.source,router,()=>left.run(async()=>{
   for(const row of f.values)assert.deepEqual(await source.object(row.id),row.value);
   const receipt={...counters};if(cached){allowed=false;await assert.rejects(source.object(f.values[0].id),{code:'ACCESS_LOCKED'});allowed=true;}return receipt;
  }));
  return (cached?run():withCatalogueCacheBoundary(source,()=>withCatalogueCacheBoundary(target,run))).finally(()=>{for(const undo of restore.reverse())undo();});
 }))));
 const baseline=await read(false),cached=await read(true);runs.push({baseline,cached});
 assert.equal(baseline.sourceSnapshots,64);assert.equal(baseline.targetSnapshots,64);assert.equal(baseline.authority,64);assert.equal(baseline.adoption,64);
 assert.equal(cached.sourceSnapshots,1);assert.equal(cached.targetSnapshots,1);assert.equal(cached.authority,1);assert.equal(cached.adoption,1);assert.equal(cached.payloads,64);assert.equal(cached.grants,64);assert.ok(cached.queries<baseline.queries);
 t.diagnostic(JSON.stringify(runs));
 await f.project.withLock(()=>f.project.catalogue(async store=>{const slot=retainedMetadataSlot(f.values[0].revision);await store.db.run('UPDATE state SET payload=$2 WHERE slot=$1',slot,store.encode('state',slot,{text:'tampered retained value'}));}));
 await assert.rejects(read(true),{code:'CATALOGUE_DAMAGED'});
});
