import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {maxReleaseRecords} from './website-release-ledger.js';

// The lab book records a saved website revision shows, each with the record
// revision its placed copy was made from. A placed copy always matches its
// source when the revision is saved, so the source provenance is exact.
export async function placedReleaseRecords(store,siteId,revision,{signal}={}){
 return store.scope(async()=>{
  const manifest=await store.current(siteId,revision),records=new Map();
  for(const row of manifest.sources){
   signal?.throwIfAborted();
   const source=await store.source(row.id);
   if(!source||source.revision!==row.revision)throw new AppError('CONFLICT');
   const owner=source.provenance;
   if(source.target!=='website'||!source.visible||!researchId(owner?.workspaceId)||!researchId(owner?.recordId)||!revisionId(owner?.recordRevision))continue;
   records.set(owner.workspaceId+'/'+owner.recordId,{workspaceId:owner.workspaceId,recordId:owner.recordId,recordRevision:owner.recordRevision});
   if(records.size>maxReleaseRecords)throw new AppError('LIMIT');
  }
  return [...records.values()];
 },{signal});
}
