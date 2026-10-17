import {retainPublicationInput as retainLegacyPublicationInput} from './publication-input-legacy.js';
import {publicationResearchWorkspace} from './publication-pin.js';
import {removePublicationMedia} from './publication-input-media.js';
import {recordReferenceNamespaces} from './research-reference-namespace.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {recordRevision} from './research.js';
import {researchId,researchReference} from './web/research-reference.js';
import {ResearchMaterials} from './research-materials.js';
import {publicationDependencyState} from './publication-analysis-inputs.js';
import {proseReferences} from './web/prose-model.js';
import {emptyEditionSelection,defaultEditionRecord,selectEditionRecord} from './web/publication-selection.js';
import {validateEditionSelection,validateEditionRecord} from './publication-selection.js';
import {publicationDescriptor} from './publication-record-descriptor.js';
import {retainSelectedRevisionRows} from './publication-revisions.js';
import {publicationOriginal} from './publication-source.js';
import {createPublicationInput,publicationInputState,openPublicationInput,publicationRecordIndexes} from './publication-input-reader.js';
import {PublicationCaptureIdentities} from './publication-owner-identities.js';
import {appendPublicationOwnerCollections,projectPublicationRecord,retainPublicationAliases} from './publication-owner-projection.js';
import {retainWebsitePublicationCollections,claimPublicationFile} from './publication-capture-website.js';
import {isPublicationDocumentBlockName} from './publication-document.js';
import {finalizePublicationInput} from './publication-capture-finalize.js';
const recordFile=(job,id)=>{if(!researchId(job)||!researchId(id))throw new AppError('INVALID');return '.observanda/release-inputs/'+job+'/'+id+'.json';};
export {publicationDescriptor} from './publication-record-descriptor.js';
export {finalizePublicationInput};

// Each selected original is consumed once. Corpus membership, provenance and
// collision evidence live in the immutable owner rather than capture arrays.
export async function retainPublicationInput(workspace,id,metadata,originals,{sourceEtag,recordHead,signal,sourceReader,edition=emptyEditionSelection(),deferFinalization=false,hasSources=false,websitePages,websiteCollections,websitePresentation,input=null,owner={workspaceId:metadata.id},destination=workspace,identities=null,snapshotId=null,onRecord}={}){
 if(await destination.storageKind()!=='catalogue')return retainLegacyPublicationInput(workspace,id,metadata,originals,{sourceEtag,recordHead,signal,sourceReader,edition,deferFinalization,websitePages,websitePresentation});
 validateEditionSelection(edition);const choices=new Map(edition.records.map(row=>[row.id,row])),found=new Set(),fresh=!input;
 input??=createPublicationInput(destination,id,metadata,{signal});const state=publicationInputState(input),builder=state.builder;
 identities??=state.identities??=new PublicationCaptureIdentities(state.header.metadata.id,builder);if(fresh)state.header.hasSources=hasSources;
 await appendPublicationOwnerCollections(builder,metadata,owner,identities,{signal});
 if(fresh)await retainWebsitePublicationCollections(destination,builder,id,metadata,{websiteCollections,websitePages,websitePresentation,signal});
 const research=publicationResearchWorkspace(workspace),materials=new ResearchMaterials(research),review={retainedFigures:0,changedInputs:0,editedFigures:0};
 async function pin(original,choice,pageId=original.id){
  signal?.throwIfAborted();const saved=publicationOriginal(original),revision=recordRevision(saved),selection=choice??defaultEditionRecord(original,revision),record=selectEditionRecord(original,selection),raw=serialize(saved);
  const cover=metadata.id===state.header.metadata.id?await builder.get('covers',original.id):null,cardMetadata=cover?{...metadata,website:{...metadata.website,presentation:{...metadata.website.presentation,covers:[cover]}}}:metadata;
  let descriptor={...publicationDescriptor(record,cardMetadata),id:pageId,revision,sha256:digest(raw),selection};
  if(pageId!==original.id){descriptor.recordId=original.id;descriptor.historical=true;}
  if(await research.storageKind()==='catalogue')descriptor.referenceNamespaces=await research.catalogue(store=>recordReferenceNamespaces(store,{workspaceId:metadata.id,id:original.id}));
  descriptor=await projectPublicationRecord(descriptor,owner,identities);
  await claimPublicationFile(builder,descriptor.id,'record',descriptor.id);await destination.writeMetadata(recordFile(id,descriptor.id),raw);
  const notebook=await builder.get('notebooks',descriptor.notebookId),position=builder.count('records');
  if(!notebook)throw new AppError('PUBLICATION_IDENTITY');
  await builder.append('records',descriptor.id,descriptor,{indexes:publicationRecordIndexes(descriptor,position,notebook.projectId)});
  await builder.append('recordPositions',descriptor.id,{position});await retainPublicationAliases(builder,'record',descriptor,metadata.id);
  if(proseReferences(record.body).length)await builder.append('linkedCards',descriptor.id,{id:descriptor.id});
  const released=await materials.releaseSources({...metadata,entries:[record]},[record.id],{sourceEtag,recordHead});
  for(const source of released.sources){const key=metadata.id+'/'+String(builder.count('sourceMaterials')).padStart(16,'0');await builder.append('sourceMaterials',key,{workspaceId:metadata.id,source},{indexes:{owner:metadata.id+'/'}});if(source.figureId)review.retainedFigures++;}
  for(const warning of released.warnings){if(warning.reason==='inputs')review.changedInputs++;if(warning.reason==='edited')review.editedFigures++;}
  await onRecord?.(descriptor);return descriptor;
 }
 const start=builder.count('records');
 for await(const original of originals){
  signal?.throwIfAborted();if(!original.share||!metadata.notebooks.some(notebook=>notebook.id===original.notebookId&&metadata.projects.some(project=>project.id===notebook.projectId&&project.share)))continue;
  const choice=choices.get(original.id);if(choice){found.add(original.id);validateEditionRecord(original,choice);if(!choice.include)continue;}await pin(original,choice);
 }
 if(found.size!==choices.size)throw new AppError('RECORD_CHANGED');
 await retainSelectedRevisionRows(workspace,metadata,edition,async position=>(await builder.window('records',{offset:position,limit:1})).items[0]?.value,()=>builder.count('records'),pin,{signal,start});
 for(const note of edition.availability??[]){
  const publicId=await identities.identity(metadata.id,'record',note.recordId),row=await builder.get('records',publicId),href=researchReference(note.target);
  if(!row||![...row.relations.map(link=>link.target),...row.references].some(value=>researchReference(value)===href))throw new AppError('INVALID');
  await builder.append('availability',publicId+'/'+digest(serialize(note.target)),{...note,recordId:publicId},{indexes:{record:publicId+'/'}});
 }
 const reader=await openPublicationInput(destination,input,{signal});
 const analysis=await publicationDependencyState(materials,reader.sourceMaterials({workspaceId:metadata.id}),{workspaceId:metadata.id,sourceReader,recordHead,signal,onItem:async item=>{
  const value=!state.header.hasSources?item:{...item,id:digest(metadata.id+'/'+item.id),recordId:await identities.identity(metadata.id,'record',item.recordId),sourceWorkspaceId:metadata.id};
  await builder.append('analysisItems',value.id,value,{indexes:{owner:metadata.id+'/'}});
 }});
 await builder.append('sourceGroups',metadata.id,{workspaceId:metadata.id,snapshotId,analysis});
 state.header.researchReview??={retainedFigures:0,changedInputs:0,editedFigures:0};for(const key of Object.keys(review))state.header.researchReview[key]+=review[key];
 return deferFinalization?input:finalizePublicationInput(destination,id,input,{signal});
}
export async function readPublicationRecord(workspace,source,row){return (await readPinnedPublicationRecord(workspace,source,row)).record;}
export async function readPinnedPublicationRecord(workspace,source,row){
 if(source.version===1){const record=source.book.entries.find(value=>value.id===row.id);if(!record)throw new AppError('JOB_DAMAGED');return {record,raw:null};}
 const raw=await workspace.readMetadata(recordFile(source.id,row.id),4*1024*1024);
 if(raw===null||digest(raw)!==row.sha256)throw new AppError('JOB_DAMAGED');
 let record;try{record=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
 if(record.id!==(row.recordId??row.id)||recordRevision(record)!==row.revision)throw new AppError('JOB_DAMAGED');return {record,raw};
}
export async function removePublicationInput(workspace,id){
 if(!researchId(id))throw new AppError('INVALID');const prefix='.observanda/release-inputs/'+id;
 for await(const name of workspace.metadataNames(prefix)){
  if(!isPublicationDocumentBlockName(name)&&(!name.endsWith('.json')||!researchId(name.slice(0,-5))))throw new AppError('JOB_DAMAGED');
  await workspace.removeMetadata(prefix+'/'+name);
 }
 await removePublicationMedia(workspace,id);await workspace.removeMetadata(prefix+'.json').catch(error=>{if(error.code!=='ENOENT')throw error;});
}
