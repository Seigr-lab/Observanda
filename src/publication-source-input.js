import {ResearchMaterials} from './research-materials.js';
import {AppError} from './errors.js';
import {publicationAnalysisGroups} from './publication-analysis-state.js';
import {validPublicationSources,publicationSourceMetadata} from './web/publication-sources-model.js';
import {selectedPublicationRecords} from './publication-source.js';
import {retainPublicationInput,finalizePublicationInput} from './publication-input.js';
import {retainPublicationMedia} from './publication-input-media.js';
import {publicationOwnerProjection} from './publication-owner-projection.js';
import {PublicationOwnerIdentities} from './publication-owner-identities.js';
import {MediaStore} from './media.js';

function pinOwner(host,source,jobId,namespace,identities,store){
 const prefix='.observanda/release-inputs/'+jobId+'/';
 const retained=file=>typeof file==='string'&&file.startsWith(prefix)&&/^[a-f0-9-]{36}\.json$/.test(file.slice(prefix.length));
 const mapped=file=>prefix+identities.identity(namespace,'record',file.slice(prefix.length,-5))+'.json';
 return new Proxy(source,{get(target,key){
  if(key==='catalogue')return operation=>operation(store);
  if(['readMetadata','writeMetadata'].includes(key))return (file,...args)=>retained(file)?host[key](mapped(file),...args):target[key](file,...args);
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
}
function appendCollections(target,incoming){
 for(const key of ['projects','notebooks'])for(const item of incoming[key]){
  const existing=target[key].find(value=>value.id===item.id);
  if(!existing){target[key].push(item);continue;}
  if(existing.sourceId!==item.sourceId||key==='notebooks')throw new AppError('PUBLICATION_IDENTITY');
  existing.referenceNamespaces=[...new Set([...existing.referenceNamespaces,...item.referenceNamespaces])];
 }
}
// Pin one selected namespace at a time, then release its credentials. A website
// owns presentation consent; no research sharing flag is changed in its owner.
export async function retainPublicationSources(workspace,jobId,local,sources,reader,{signal}={}){
 if(!validPublicationSources(sources)||sources.some(source=>source.workspaceId===local.metadata.id))throw new AppError('INVALID');
 if(!sources.length)return finalizePublicationInput(workspace,jobId,local,{signal});
 if(!reader)throw new AppError('ACCESS_LOCKED');
 const identities=new PublicationOwnerIdentities(local.metadata.id),base=publicationOwnerProjection(local,{workspaceId:local.metadata.id},identities);
 const groups=[{workspaceId:local.metadata.id,materials:local.sourceMaterials,analysis:local.researchReview.analysis}],snapshots=[],retainedMedia=[];
 const merged={...base,metadata:{...base.metadata,projects:[...base.metadata.projects],notebooks:[...base.metadata.notebooks]},records:[...base.records],sourceRevisions:{...base.sourceRevisions},availability:[...base.availability],linkedCards:[...base.linkedCards],researchReview:{...base.researchReview}};
 try{
  for(const source of sources){
   signal?.throwIfAborted();
   await reader.use(source.workspaceId,undefined,async(store,snapshot,pinned)=>{
    const metadata=publicationSourceMetadata(snapshot.metadata,source),owner={...pinned.owner,projectNamespaceId:pinned.projectNamespaceId},storage=pinOwner(workspace,pinned.storage,jobId,source.workspaceId,identities,store);
    const records=selectedPublicationRecords(store,snapshot,{metadata,selection:source.selection,signal});
    const input=await retainPublicationInput(storage,jobId,metadata,records,{sourceEtag:pinned.snapshotId,recordHead:async id=>(await store.member(snapshot,id))?.revision??null,signal,deferFinalization:true,edition:source.edition});
    const projected=publicationOwnerProjection(input,owner,identities),media=new MediaStore(pinned.storage),assets=new Map();
    for(const record of projected.records)for(const [id,publicId] of Object.entries(record.mediaIdentities))assets.set(publicId,id);
    async function* selectedAssets(){for(const [publicId,id] of assets){signal?.throwIfAborted();yield {...await media.get(id,{streamed:true,includeHeader:false,signal}),id:publicId};}}
    if(assets.size)retainedMedia.push(...await retainPublicationMedia(workspace,jobId,selectedAssets(),{signal}));
    appendCollections(merged.metadata,projected.metadata);merged.records.push(...projected.records);
    for(const [id,revision] of Object.entries(input.sourceRevisions))merged.sourceRevisions[identities.identity(source.workspaceId,'record',id)]=revision;
    merged.availability.push(...input.availability.map(note=>({...note,recordId:identities.identity(source.workspaceId,'record',note.recordId)})));
    merged.linkedCards.push(...input.linkedCards.map(id=>identities.identity(source.workspaceId,'record',id)));
    for(const key of ['retainedFigures','changedInputs','editedFigures'])merged.researchReview[key]+=input.researchReview[key];
    groups.push({workspaceId:source.workspaceId,materials:input.sourceMaterials,analysis:input.researchReview.analysis});snapshots.push({workspaceId:source.workspaceId,snapshotId:pinned.snapshotId});
   },{prepare:storage=>new ResearchMaterials(storage).index.ensure()});
  }
  await reader.verify();
  merged.researchReview.analysis=publicationAnalysisGroups(groups,identities);
  return await finalizePublicationInput(workspace,jobId,{...merged,sourceGroups:groups,sourceSnapshots:snapshots,retainedMedia},{signal});
 }finally{await reader.close();}
}
