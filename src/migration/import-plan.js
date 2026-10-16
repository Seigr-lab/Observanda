import {AppError} from '../errors.js';
import {recordRevision} from '../research.js';
import {validateDetachedRecords} from '../model.js';
import {sourceKey} from './adapters.js';
import {importHash,identityKey,revisionKey,importOccurrence,mergeImport,mappedId,sourceFingerprint as fingerprintSource} from './import-model.js';
import {importContent} from './content.js';
import {prepareImportedDataset} from './import-dataset.js';
import {overlappingSelections} from './boundaries.js';
import {prepareImportedFigure} from './import-figure.js';
import {importResearch,verifyImportedResearch} from './import-research.js';

export function importOrder(rows){
 const targets=new Map(rows.map(r=>[sourceKey(r.source),r])),groups=new Map(),edges=new Map(),parents=new Map();
 for(const row of rows){
  if(row.mapping.disposition==='exclude')continue;
  const group=groups.get(row.source.id)??[];group.push(row);groups.set(row.source.id,group);
  const dependencies=new Set();
  row.source.links.forEach((link,i)=>{
   const rule=row.mapping.links[i],target=targets.get(sourceKey(link));if(rule.mode==='omit')return;
   if(!target||target.mapping.disposition==='exclude')throw new AppError('IMPORT_DEPENDENCY',[{index:row.index,link:i}]);
   if(rule.role==='run-of'&&(row.mapping.type!=='run'||target.mapping.type==='run')||rule.role==='follows-run'&&row.mapping.type!=='run')throw new AppError('IMPORT_MAPPING',[{index:row.index,link:i}]);
   if(rule.mode==='exact')dependencies.add(target.index);
  });edges.set(row.index,dependencies);
 }
 for(const group of groups.values())if(group.filter(r=>r.mapping.current).length!==1)throw new AppError('IMPORT_CURRENT',[{indexes:group.map(r=>r.index)}]);
 for(const [index,dependencies] of edges)for(const d of dependencies){const list=parents.get(d)??[];list.push(index);parents.set(d,list);}
 const queue=[...edges].filter(([,d])=>!d.size).map(([i])=>i),order=[];
 for(let at=0;at<queue.length;at++){const i=queue[at];order.push(i);for(const parent of parents.get(i)??[]){const d=edges.get(parent);d.delete(i);if(!d.size)queue.push(parent);}}
 if(order.length!==edges.size)throw new AppError('IMPORT_CYCLE');
 return [...rows.filter(r=>r.mapping.disposition==='exclude').map(r=>r.index),...order];
}
export async function prepareObject(store,batch,row,targets,{signal}={}){
 const {source,mapping,index}=row;
 if(mapping.disposition==='exclude')return {action:'exclude',reason:mapping.reason,conflicts:[],changed:[]};
 const namespace=batch.source.namespace,key=identityKey(namespace,source.id),versionKey=revisionKey(namespace,source.id,source.revision);
 const previous=await store.read('identities/'+key,{optional:true}),version=await store.read('revisions/'+versionKey,{optional:true});
 const id=mappedId(batch.workspaceId,namespace,source.id),createdAt=previous?.createdAt??batch.createdAt;
 const attributesText=row.attributesText??null;if(source.attributes&&typeof attributesText!=='string')throw new AppError('IMPORT_DAMAGED');
 const sourceFingerprint=fingerprintSource(source,attributesText),fingerprint=importHash({sourceFingerprint,mapping:{...mapping,resolution:'merge',current:false,acknowledgeConversion:false}});
 const sourceChanged=!!version&&version.sourceFingerprint!==sourceFingerprint;
 const file=source.files[mapping.contentFile],excluded=await store.read('boundaries/'+batch.id+'/'+importHash(file.path),{optional:true});
 if(mapping.contentMode!=='original'&&excluded?.some(other=>overlappingSelections(file,other)))throw new AppError('IMPORT_EXCLUDED_BOUNDARY');
 const content=await store.original(file.sha256,{signal}),dataset=mapping.contentMode==='dataset'?await prepareImportedDataset(store,batch,row,content,{signal}):null;
 const converted=dataset?{body:'',conversion:'dataset',omitted:[]}:mapping.contentMode==='figure'?await prepareImportedFigure(content,file,id,{signal}):await importContent(content,file,mapping.contentMode,{signal});
 if(converted.omitted.length&&!mapping.acknowledgeConversion)throw new AppError('IMPORT_CONVERSION',[{index,omitted:converted.omitted}]);
 const relations=[];
 for(let i=0;i<source.links.length;i++){
  const link=source.links[i],rule=mapping.links[i];if(rule.mode==='omit')continue;
  const target=await targets(link);if(!target||target.mapping.disposition==='exclude')throw new AppError('IMPORT_DEPENDENCY',[{index,link:i}]);
  const targetId=mappedId(batch.workspaceId,namespace,link.id),destination={workspaceId:batch.workspaceId,kind:'record',id:targetId};
  if(rule.mode==='exact'){
   const targetRow=await store.object(batch.id,target.index);if(!targetRow.prepared?.sourceRecord)throw new AppError('IMPORT_REVIEW');
   destination.revision=recordRevision(targetRow.prepared.sourceRecord);
  }
  relations.push({id:mappedId(id,'link',i),type:link.type,label:target.mapping.title,target:destination,...(rule.role?{role:rule.role}:{})});
 }
 let sourceRecord={id,notebookId:mapping.notebookId,type:mapping.type,title:mapping.title,body:converted.body,
  contributors:mapping.contributors.map((c,i)=>({id:mappedId(id,'contributor',i),...c})),relations,tags:[],occurredOn:importOccurrence(source,mapping),
  createdAt,updatedAt:batch.createdAt,share:false,figures:converted.figures??[],status:'draft',sections:[],attachments:[]};
 // Older saved mappings included metadata in the narrative. Preserve their
 // reviewed behavior; new mappings explicitly default to provenance only.
 if((mapping.metadataMode??'section')==='section'&&attributesText&&attributesText!=='{}')sourceRecord.sections.push({id:mappedId(id,'attributes'),title:batch.labels.attributes,body:attributesText});
 sourceRecord=await importResearch(attributesText,mapping.research,sourceRecord,{signal});
 // A matching mapping is only reusable if its dependencies are still the same.
 if(version?.fingerprint===fingerprint){
  const comparison={...sourceRecord,createdAt:version.sourceRecord.createdAt,updatedAt:version.sourceRecord.updatedAt};
  if(importHash(comparison)===importHash(version.sourceRecord))sourceRecord=version.sourceRecord;
 }
 validateDetachedRecords([sourceRecord]);
 await verifyImportedResearch(store.workspace,batch.workspaceId,sourceRecord);
 const selection=await store.workspace.catalogue(async catalogue=>{
  const snapshot=await catalogue.snapshot(),member=await catalogue.member(snapshot,id);
  if(!snapshot.metadata.notebooks.some(n=>n.id===mapping.notebookId))throw new AppError('IMPORT_MAPPING');
  return member?{record:await catalogue.record(id,member.revision),storedRevision:member.revision}:null;
 });
 const selected=selection?.record??null;
 if(selected&&!previous)throw new AppError('IMPORT_COLLISION');
 const merge=mapping.current?mergeImport(previous?.sourceRecord,selected,sourceRecord,mapping.resolution):{record:null,conflicts:[],changed:[]};
 if(dataset?.conflict)merge.conflicts.push('dataset');
 if(merge.record&&selected){
  merge.record.updatedAt=selected.updatedAt;
  if(recordRevision(merge.record)!==recordRevision(selected))merge.record.updatedAt=batch.createdAt;
 }
 if(merge.record){validateDetachedRecords([merge.record]);await verifyImportedResearch(store.workspace,batch.workspaceId,merge.record);}
 return {action:!mapping.current?'retain':!selected?'create':recordRevision(merge.record)===recordRevision(selected)?'unchanged':'update',
  sourceRecord,currentRecord:selected,record:merge.record,expectedRevision:selected?recordRevision(selected):null,storedRevision:selection?.storedRevision??null,identityKey:key,versionKey,
  previousIdentity:previous,previousVersion:version,fingerprint,sourceFingerprint,sourceChanged,attributesText,
  conflicts:merge.conflicts,changed:merge.changed,conversion:{kind:converted.conversion,omitted:converted.omitted,...(converted.mappings?{mappings:converted.mappings}:{})},
  dataset,unresolved:merge.conflicts.includes('attempt')||merge.conflicts.length>0&&mapping.resolution==='merge'};
}
