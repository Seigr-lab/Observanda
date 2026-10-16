import {moduleDraftOwners,moduleDraftDomain} from './modules/draft-domains.js';
import {projectModuleDraftContext} from './project-module-draft-context.js';
import {checkProjectModuleDraft} from './project-module-drafts.js';
import {ModuleDraftTransfer} from './modules/draft-transfer.js';
import {DRAFT_CHUNK_BYTES} from './web/modules/draft-protocol.js';
import {uuid,exact} from './modules/validation.js';
import {digest} from './storage-format.js';
import {operationStage,operationTotal,operationAdvance} from './operation-progress.js';
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function verifyProjectModuleDrafts(context,domain){
 const owner=await context.inspect(domain),allowed=moduleDraftOwners.filter(id=>moduleDraftDomain(id)===domain);
 for await(const row of owner.db.rows('SELECT slot FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',['module-drafts:','module-drafts;'])){
  const parts=row.slot.split(':');if(context.registry.authoringVersion!==1||!allowed.includes(parts[1])||parts.length>2&&!['index','value'].includes(parts[2]))fail();
 }
 if(context.registry.authoringVersion!==1)return;
 for(const moduleId of allowed)await operationStage('verify-module-drafts',{item:moduleId,unit:'objects'},async()=>{
  const {workspace,store,drafts}=await projectModuleDraftContext(context,moduleId),index=store.objectIndex({cacheReads:true}),head=await index.head(),transfers=new ModuleDraftTransfer(workspace);
  await index.checkCounts(head);operationTotal(head.root?.count??0);
  for await(const entry of index.entries(head)){
   const value=await store.objectValue(entry.id,entry);if(typeof value?.text!=='string')fail();
   const name=entry.id.replace('metadata:.observanda/','');if(name===entry.id)fail();
   if(name.startsWith('module-drafts/')){
    const id=name.slice('module-drafts/'.length,-5);if(!name.endsWith('.json')||!uuid(id))fail();const result=await drafts.read(id);if(!result)fail();checkProjectModuleDraft(result.draft,moduleId);
   }else if(name==='module-draft-list.json')await drafts.index.initialized(context.registry.namespaceId);
   else if(name.startsWith('module-draft-list/')){
    if(!name.startsWith('module-draft-list/'+moduleId+'/'))fail();
   }else if(name.startsWith('module-draft-transfers/')){
    const parts=name.split('/');if(parts.length!==3||!uuid(parts[1]))fail();const manifest=await transfers.manifest(parts[1]);if(manifest.workspaceId!==context.registry.namespaceId)fail();
    if(parts[2]==='manifest.json'){if(manifest.etag)await transfers.receipt(manifest);}
    else{
     const ordinal=Number(parts[2].slice(0,-5));if(!Number.isSafeInteger(ordinal)||ordinal<0||parts[2]!==ordinal+'.json'||ordinal>=Math.ceil(manifest.size/DRAFT_CHUNK_BYTES)||manifest.etag)fail();
     let chunk;try{chunk=JSON.parse(value.text);}catch{fail();}if(!exact(chunk,['sha256','bytes'])||typeof chunk.bytes!=='string')fail();const bytes=Buffer.from(chunk.bytes,'base64');if(bytes.length!==Math.min(DRAFT_CHUNK_BYTES,manifest.size-ordinal*DRAFT_CHUNK_BYTES)||bytes.toString('base64')!==chunk.bytes||digest(bytes)!==chunk.sha256)fail();
    }
   }else fail();
   operationAdvance();
  }
  // Every summary must match one retained original. A complete list also
  // rejects orphan summaries rather than trusting only selected checkpoints.
  let cursor=null;do{const page=await drafts.list(moduleId,{workspaceId:context.registry.namespaceId,limit:20,cursor});cursor=page.nextCursor;}while(cursor);
 });
}
