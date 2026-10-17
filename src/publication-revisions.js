import {publicationResearchWorkspace} from './publication-pin.js';
import {workspaceReferenceNamespaceMatches} from './research-reference-namespace.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {recordRevision} from './research.js';
import {ResearchMaterials} from './research-materials.js';
import {publicationSource} from './publication-source.js';
import {proseReferences,proseText} from './web/prose-model.js';
import {attemptReferences} from './web/attempt-model.js';
import {researchId,researchReference} from './web/research-reference.js';
import {editionRevisionKey,selectEditionRecord,validEditionRecord} from './web/publication-selection.js';
import {validateEditionRecord} from './publication-selection.js';
import {recordEditionInventory} from './web/publication-inventory.js';
import {customFieldLabel} from './web/custom-field-presentation.js';

export function editionReferences(record){
 const values=[...record.relations.map(r=>r.target),...[record.body,...record.sections.map(s=>s.body)].flatMap(proseReferences),...attemptReferences(record.attempt).filter(r=>r.kind==='record')];
 return [...new Map(values.map(r=>[researchReference(r),r])).values()];
}
// A publication page has its own stable identity. The encrypted original keeps
// its research identity and hash; current and historical pages cannot overwrite
// one another or share different chart bytes under the same output filename.
export function revisionPageId(workspaceId,id,revision){
 const h=digest('observanda-public-revision-v1:'+workspaceId+':'+id+':'+revision);
 return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
}
export async function exactPublicationRecord(workspace,target){
 workspace=publicationResearchWorkspace(workspace);
 if(!await workspaceReferenceNamespaceMatches(publicationResearchWorkspace(workspace),target))throw new AppError('WORKSPACE_CHANGED');
 const materials=new ResearchMaterials(workspace);
 let record;
 try{record=await materials.read(target);}catch(error){
  if(error.code!=='MATERIAL_MISSING')throw error;
  if(await workspace.storageKind()!=='catalogue')throw error;
  record=await workspace.catalogue(async store=>{
   const row=await store.db.get('SELECT 1 FROM records WHERE id=$1 AND revision=$2',target.id,target.revision);
   if(row)return store.record(target.id,target.revision);
   // Public references use the canonical content revision. Encrypted catalogue
   // rows use their storage revision; the authenticated history binds the two.
   if(!await store.db.get('SELECT 1 FROM records WHERE id=$1 LIMIT 1',target.id))throw new AppError('MATERIAL_MISSING');
   const history=store.historyIndex(target.id),saved=await history.lookup(await history.head(),'view',target.revision,{optional:true});
   if(!saved)throw new AppError('MATERIAL_MISSING');
   return store.record(target.id,saved.item.revision);
  });
 }
 if(record.id!==target.id||recordRevision(record)!==target.revision)throw new AppError('CATALOGUE_DAMAGED');
 return record;
}
export function editionRecordInventory(record,metadata){
 return {...recordEditionInventory(record,recordRevision(record)),notebook:metadata.notebooks.find(n=>n.id===record.notebookId)?.title??''};
}
// Fetch only the selected referring record and one bounded page of its exact
// references. Authenticated preview prose never enters a public descriptor.
export async function publicationReferences(workspace,{source,recordId,revision,choice,offset=0},{signal}={}){
 if(!source||!researchId(recordId)||revision!==undefined&&!revisionId(revision)||choice&&revision&&choice.revision!==revision||choice!==undefined&&!validEditionRecord(choice)||choice&&choice.id!==recordId||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new AppError('INVALID');
 return publicationSource(workspace,source,{signal,page:{recordId,offset:0,limit:1},consume:async(metadata,records)=>{
  const selected=revision?[await exactPublicationRecord(workspace,{workspaceId:metadata.id,kind:'record',id:recordId,revision})]:await Array.fromAsync(records);if(selected.length!==1)throw new AppError('RECORD_CHANGED');
  validateEditionRecord(selected[0],choice);
  const refs=editionReferences(selectEditionRecord(selected[0],choice)),items=[];
  for(const target of refs.slice(offset,offset+20)){
   signal?.throwIfAborted();let record=null;
   if(target.kind==='record'&&target.revision&&await workspaceReferenceNamespaceMatches(publicationResearchWorkspace(workspace),target)){try{record=await exactPublicationRecord(workspace,target);}catch(error){if(!['MATERIAL_MISSING'].includes(error.code))throw error;}}
   const item={target,available:!!record};
   if(record){item.record={...editionRecordInventory(record,metadata),pageId:revisionPageId(metadata.id,record.id,target.revision)};item.preview={body:proseText(record.body),sections:record.sections.map(s=>({title:s.title,body:proseText(s.body)})),fields:(record.template?.fields??[]).map(f=>({title:customFieldLabel(f),value:String(record.template.values[f.key]??'')}))};}
   items.push(item);
  }
  return {items,offset,next:refs.length>offset+20?offset+20:null};
 }});
}
export async function retainSelectedRevisions(workspace,metadata,edition,records,pin,{signal}={}){
 const pending=new Map((edition.history??[]).filter(c=>c.include).map(c=>[editionRevisionKey(c),c]));
 // Traverse only explicitly approved revisions. References grant no implicit
// publication consent; cycles terminate because each choice is consumed once.
 for(let i=0;i<records.length;i++)for(const target of [...records[i].relations.map(r=>r.target),...records[i].references]){
  const key=editionRevisionKey(target),choice=pending.get(key);if(!choice||!await workspaceReferenceNamespaceMatches(publicationResearchWorkspace(workspace),target))continue;
  if(records.some(r=>r.historical&&r.recordId===target.id&&r.revision===target.revision)){pending.delete(key);continue;}
  const original=await exactPublicationRecord(workspace,target);validateEditionRecord(original,choice);
  if(!metadata.notebooks.some(n=>n.id===original.notebookId&&metadata.projects.some(p=>p.id===n.projectId&&p.share)))throw new AppError('INVALID');
  signal?.throwIfAborted();pending.delete(key);await pin(original,choice,revisionPageId(metadata.id,original.id,choice.revision));
 }
 if(pending.size)throw new AppError('INVALID');
}
// A forward cursor over the growing immutable record collection also visits
// newly admitted history. Explicit consent bounds pending history choices.
export async function retainSelectedRevisionRows(workspace,metadata,edition,at,count,pin,{signal,start=0}={}){
 const pending=new Map((edition.history??[]).filter(choice=>choice.include).map(choice=>[editionRevisionKey(choice),choice]));
 for(let position=start;position<count();position++){
  const row=await at(position);if(!row)throw new AppError('JOB_DAMAGED');
  for(const target of [...row.relations.map(relation=>relation.target),...row.references]){
   const key=editionRevisionKey(target),choice=pending.get(key);if(!choice||!await workspaceReferenceNamespaceMatches(publicationResearchWorkspace(workspace),target))continue;
   const original=await exactPublicationRecord(workspace,target);validateEditionRecord(original,choice);
   if(!metadata.notebooks.some(notebook=>notebook.id===original.notebookId&&metadata.projects.some(project=>project.id===notebook.projectId&&project.share)))throw new AppError('INVALID');
   signal?.throwIfAborted();pending.delete(key);await pin(original,choice,revisionPageId(metadata.id,original.id,choice.revision));
  }
 }
 if(pending.size)throw new AppError('INVALID');
}
