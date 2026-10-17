import {publicationResearchWorkspace} from './publication-pin.js';
import {removePublicationMedia} from './publication-input-media.js';
import {recordReferenceNamespaces} from './research-reference-namespace.js';
import {PublicationLinks,projectPublicationLinks} from './publication-links.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {recordRevision} from './research.js';
import {researchId} from './web/research-reference.js';
import {publicationExcerpt} from './web/publication-card.js';
import {publicationLinkResolver,publicationRecordText} from './publication-prose.js';
import {websiteSummary} from './web/website-model.js';
import {ResearchMaterials} from './research-materials.js';
import {publicationDependencyState} from './publication-analysis-inputs.js';
import {proseReferences} from './web/prose-model.js';
import {emptyEditionSelection,defaultEditionRecord,selectEditionRecord} from './web/publication-selection.js';
import {validateEditionSelection,validateEditionRecord} from './publication-selection.js';
import {researchReference} from './web/research-reference.js';
import {publicationDescriptor} from './publication-record-descriptor.js';
import {retainSelectedRevisions} from './publication-revisions.js';
import {publicationOriginal} from './publication-source.js';
const recordFile=(job,id)=>{if(!researchId(job)||!researchId(id))throw new AppError('INVALID');return '.observanda/release-inputs/'+job+'/'+id+'.json';};
export {publicationDescriptor} from './publication-record-descriptor.js';
// Each edition pins its selected originals independently. The job manifest and
// page renderer retain descriptors, never a second in-memory corpus of prose.
export async function retainPublicationInput(workspace,id,metadata,originals,{sourceEtag,recordHead,signal,sourceReader,edition=emptyEditionSelection(),deferFinalization=false}={}){
 validateEditionSelection(edition);const choices=new Map(edition.records.map(r=>[r.id,r])),found=new Set();
 const projects=new Set(metadata.projects.filter(p=>p.share).map(p=>p.id)),notebooks=new Set(metadata.notebooks.filter(n=>projects.has(n.projectId)).map(n=>n.id));
 const records=[],sourceRevisions={},sourceMaterials=[],warnings=[],linkedCards=new Set(),research=publicationResearchWorkspace(workspace),materials=new ResearchMaterials(research);
 async function pin(original,choice,pageId=original.id){
  const saved=publicationOriginal(original),revision=recordRevision(saved),selection=choice??defaultEditionRecord(original,revision),record=selectEditionRecord(original,selection),raw=serialize(saved);
  await workspace.writeMetadata(recordFile(id,pageId),raw);
  const descriptor={...publicationDescriptor(record,metadata),id:pageId,revision,sha256:digest(raw),selection};
  if(pageId!==original.id){descriptor.recordId=original.id;descriptor.historical=true;}
  records.push(descriptor);
  if(proseReferences(record.body).length)linkedCards.add(pageId);
  sourceRevisions[pageId]=revision;
  const review=await materials.releaseSources({...metadata,entries:[record]},[record.id],{sourceEtag,recordHead});
  sourceMaterials.push(...review.sources);warnings.push(...review.warnings);
 }
 for await(const original of originals){
  signal?.throwIfAborted();if(!original.share||!notebooks.has(original.notebookId))continue;
  const choice=choices.get(original.id);if(choice){found.add(original.id);validateEditionRecord(original,choice);if(!choice.include)continue;}
  await pin(original,choice);
 }
 if(found.size!==choices.size)throw new AppError('RECORD_CHANGED');
 await retainSelectedRevisions(workspace,metadata,edition,records,pin,{signal});
 if(await research.storageKind()==='catalogue')await research.catalogue(async store=>{for(const row of records){signal?.throwIfAborted();row.referenceNamespaces=await recordReferenceNamespaces(store,{workspaceId:metadata.id,id:row.recordId??row.id});}});
 for(const note of edition.availability??[]){
  const owner=records.find(r=>r.id===note.recordId),href=researchReference(note.target);
  if(!owner||![...owner.relations.map(r=>r.target),...owner.references].some(r=>researchReference(r)===href))throw new AppError('INVALID');
 }

 const analysis=await publicationDependencyState(materials,sourceMaterials,{workspaceId:metadata.id,sourceReader,recordHead,signal});
 const input={metadata,records,sourceRevisions,sourceMaterials,availability:edition.availability??[],linkedCards:[...linkedCards],
  researchReview:{retainedFigures:sourceMaterials.filter(source=>source.figureId).length,changedInputs:warnings.filter(warning=>warning.reason==='inputs').length,editedFigures:warnings.filter(warning=>warning.reason==='edited').length,analysis}};
 return deferFinalization?input:finalizePublicationInput(workspace,id,input,{signal});
}
export async function finalizePublicationInput(workspace,id,input,{signal}={}){
 const {metadata,records,linkedCards=[],...rest}=input;
 const selected=websiteSummary({...metadata,entries:records.map(r=>({...r,attachments:r.media}))});
 if(!selected.canPublish)throw new AppError('PUBLICATION_EMPTY');
 // Resolve reference labels only after selected membership is known. Reopen
 // one pinned original at a time; never retain corpus prose in descriptors.
 const resolve=publicationLinkResolver(metadata.id,{...selected,entries:records});
 const unresolved=[];
 for(const row of records){
  const targets=[...row.relations.map(link=>link.target),...(row.references??[])];
  const count=new Set(targets.map(researchReference).filter(href=>!resolve(href))).size;
  if(count)unresolved.push({recordId:row.id,title:row.title,count});
 }
 for(const row of records)if(linkedCards.includes(row.id)){
  signal?.throwIfAborted();const record=selectEditionRecord(await readPublicationRecord(workspace,{version:2,id},row),row.selection);
  row.excerpt=publicationExcerpt(publicationRecordText(record.body,record,resolve));
 }
 const legacyPages=projectPublicationLinks(metadata.id,{...selected,entries:records},(await new PublicationLinks(workspace).read()).config);
 return {...rest,metadata,records,legacyPages,
  summary:{projects:selected.projects.length,notebooks:selected.notebooks.length,records:records.length,pages:selected.pages.length+legacyPages.length,media:selected.media.length},
  researchReview:{...input.researchReview,references:{count:unresolved.reduce((n,row)=>n+row.count,0),items:unresolved}}};
}

export async function readPublicationRecord(workspace,source,row){return (await readPinnedPublicationRecord(workspace,source,row)).record;}
export async function readPinnedPublicationRecord(workspace,source,row){
 if(source.version===1){const record=source.book.entries.find(r=>r.id===row.id);if(!record)throw new AppError('JOB_DAMAGED');return {record,raw:null};}
 const raw=await workspace.readMetadata(recordFile(source.id,row.id),4*1024*1024);
 if(raw===null||digest(raw)!==row.sha256)throw new AppError('JOB_DAMAGED');
 const record=JSON.parse(raw);if(record.id!==(row.recordId??row.id)||recordRevision(record)!==row.revision)throw new AppError('JOB_DAMAGED');return {record,raw};
}
export async function removePublicationInput(workspace,id){
 if(!researchId(id))throw new AppError('INVALID');
 const prefix='.observanda/release-inputs/'+id;
 for await(const name of workspace.metadataNames(prefix)){
  if(!name.endsWith('.json')||!researchId(name.slice(0,-5)))throw new AppError('JOB_DAMAGED');
  await workspace.removeMetadata(prefix+'/'+name);
 }
 await removePublicationMedia(workspace,id);
 await workspace.removeMetadata(prefix+'.json').catch(error=>{if(error.code!=='ENOENT')throw error;});
}
