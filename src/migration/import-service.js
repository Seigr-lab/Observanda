import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from '../errors.js';
import {recordRevision} from '../research.js';
import {ResearchMaterials} from '../research-materials.js';
import {validateRecordChanges} from '../model.js';
import {SnapshotIndex} from '../snapshot-index.js';
import {inspectSource} from './runner.js';
import {ImportStore} from './import-store.js';
import {importHash,initialMapping,validateMapping,importId,hashValue,revisionKey} from './import-model.js';
import {importOrder,prepareObject} from './import-plan.js';
import {commitImportedDataset} from './import-dataset.js';
import {attachImportedEvidence} from './import-evidence.js';
import {ImportEvidenceRepair} from './import-evidence-repair.js';
import {protectedImportTargets} from './import-reversal.js';
import {sourceAttributes} from './content.js';
import {validateAttemptChange} from '../attempts.js';
import {validateResultSources} from '../result-statements.js';
import {appendOnlyAttempt} from '../web/attempt-model.js';

export const batchSummary=batch=>{
 const {files,order,sourcePath,labels,receipt,reversal,...summary}=batch;void files;void order;void sourcePath;void labels;
 return {...summary,receipt:receipt?{committedAt:receipt.committedAt,etag:receipt.etag,records:receipt.owned.length,materials:receipt.materialChanges.length}:null,
  reversal:reversal?{at:reversal.at,counts:reversal.counts}:null};
};
export class MigrationImport{
 constructor(workspace){this.workspace=workspace;this.store=new ImportStore(workspace);this.materials=new ResearchMaterials(workspace);}
 async create(command,{signal,onProgress}={}){
  const {id,workspaceId,source,manifest='inventory.observanda-source.json',expectedPin,notebookId}=command;
  if(!importId(id)||!importId(workspaceId)||!importId(notebookId)||!hashValue(expectedPin))throw new AppError('INVALID');
  const {metadata}=await this.workspace.outline();if(metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(!metadata.notebooks.some(n=>n.id===notebookId))throw new AppError('IMPORT_MAPPING');
  const prior=await this.store.read('batches/'+id,{optional:true}),request=importHash({workspaceId,source,manifest,expectedPin,notebookId});
  if(prior){if(prior.request!==request)throw new AppError('IMPORT_CHANGED');return batchSummary(prior);}
  if(typeof source!=='string')throw new AppError('INVALID');
  const inside=path.relative(this.workspace.root,path.resolve(source));if(!inside||!inside.startsWith('..')&&!path.isAbsolute(inside))throw new AppError('IMPORT_SOURCE');
  const report=await inspectSource({source,manifest,expectedPin},{signal,onProgress});
  if(!report.complete||!report.objects.length)throw new AppError('IMPORT_INCOMPLETE');
  const duplicates=new Map();for(const object of report.objects)duplicates.set(object.id,(duplicates.get(object.id)??0)+1);
  const {migrationMessage}=await import('./messages.js');
  const batch={version:1,id,workspaceId,request,source:report.source,sourcePath:path.resolve(source),manifest,files:report.files.map(({path,bytes,sha256})=>({path,bytes,sha256})),
   createdAt:new Date().toISOString(),labels:{attributes:migrationMessage('importSourceAttributes')},count:report.objects.length,counts:report.counts,
   state:'staging',staged:0,edit:0,prepared:0,order:null,review:null,receipt:null};
  if(Buffer.byteLength(JSON.stringify(batch))>8*1024*1024)throw new AppError('INVENTORY_LIMIT');
  return this.store.locked(async()=>{
   signal?.throwIfAborted();const existing=await this.store.read('batches/'+id,{optional:true});if(existing){if(existing.request!==request)throw new AppError('IMPORT_CHANGED');return batchSummary(existing);}
   for(let index=0;index<report.objects.length;index++){
    signal?.throwIfAborted();
    const object=report.objects[index];
    await this.store.putObject(id,index,{index,source:object,mapping:initialMapping(object,notebookId,{multiple:duplicates.get(object.id)>1}),prepared:null,problem:null});
   }
   await this.store.write('batches/'+id,batch);await this.store.addBatch(batch);return batchSummary(batch);
  });
 }
 async stage(command,{signal,onProgress}={}){
  const batch=await this.store.bound(command);if(batch.state!=='staging')return batchSummary(batch);
  const file=batch.files[batch.staged];if(file)await this.store.retain(file,batch.sourcePath,{signal,onProgress});
  const attributes=file?.path===batch.manifest?await sourceAttributes((await this.store.original(file.sha256,{signal})).stream(),{signal}):null;
  return this.store.locked(async()=>{
   signal?.throwIfAborted();const current=await this.store.bound(command);if(current.state!=='staging'||current.staged!==batch.staged)return batchSummary(current);
   if(attributes)for(const [index,text] of attributes){signal?.throwIfAborted();if(index>=current.count)throw new AppError('IMPORT_DAMAGED');const row=await this.store.object(current.id,index);row.attributesText=text;await this.store.putObject(current.id,index,row);}
   if(file)current.staged++;if(current.staged===current.files.length)current.state='mapping';
   await this.store.write('batches/'+current.id,current);return batchSummary(current);
  });
 }
 async detail(command){
  const batch=await this.store.bound(command);if(command.index>=batch.count)throw new AppError('INVALID');
  const row=await this.store.object(batch.id,command.index);if(row.reviewEdit!==batch.edit)return {...row,prepared:null,problem:null};
  if(row.prepared?.dataset){
   const doc={kind:'dataset',content:row.prepared.dataset.content},schema=await this.materials.retainedSchemaPage(doc,{limit:8}),page=await this.materials.retainedDatasetPage(doc,0,{columns:schema.items.map((_,i)=>i)});
   row.datasetPreview={columns:schema.items,columnCount:schema.total,rowCount:page.rowCount,rows:page.rows.slice(0,20).map(r=>({order:r.order,cells:r.cells.slice(0,8),valueKinds:r.valueKinds?.slice(0,8)}))};
  }
  return row;
 }
 async mapping(command){
  return this.store.locked(async()=>{
   const batch=await this.store.bound(command);if(!['mapping','reviewing','ready'].includes(batch.state)||batch.edit!==command.edit)throw new AppError('IMPORT_CHANGED');
   if(command.index>=batch.count)throw new AppError('INVALID');const row=await this.store.object(batch.id,command.index);validateMapping(command.mapping,row.source);row.mapping=structuredClone(command.mapping);row.prepared=null;row.problem=null;
   batch.edit++;batch.state='mapping';batch.prepared=0;batch.review=null;batch.order=null;
   await this.store.putObject(batch.id,row.index,row);await this.store.write('batches/'+batch.id,batch);return batchSummary(batch);
  });
 }
 async rows(batch){
  const rows=[];for(let i=0;i<batch.count;i++){
   const {source,mapping,index}=await this.store.object(batch.id,i);
   try{validateMapping(mapping,source);}catch(error){if(error instanceof AppError)throw new AppError(error.code,[{index}]);throw error;}
   rows.push({index,source:{id:source.id,revision:source.revision,links:source.links,files:source.files},
    mapping:{title:mapping.title,type:mapping.type,disposition:mapping.disposition,current:mapping.current,links:mapping.links.map(({mode,role})=>({mode,role}))}});
  }return rows;
 }
 async beginReview(command){
  return this.store.locked(async()=>{
   const batch=await this.store.bound(command);if(batch.state==='reviewing')return batchSummary(batch);
   if(!['mapping','ready'].includes(batch.state)||batch.edit!==command.edit)throw new AppError('IMPORT_CHANGED');
   const rows=await this.rows(batch);
   batch.order=importOrder(rows);batch.prepared=0;batch.state='reviewing';batch.problems=0;batch.review=null;batch.reviewNonce=randomUUID();
   for(const row of rows)await this.store.write('targets/'+batch.id+'/'+revisionKey(batch.source.namespace,row.source.id,row.source.revision),{index:row.index,mapping:{title:row.mapping.title,disposition:row.mapping.disposition,type:row.mapping.type}});
   const exclusions=new Map();for(const row of rows)for(const file of row.source.files){const files=exclusions.get(file.path)??[];if(row.mapping.disposition==='exclude')files.push(file);exclusions.set(file.path,files);}
   for(const [file,excluded] of exclusions)await this.store.write('boundaries/'+batch.id+'/'+importHash(file),excluded);
   batch.reconciliation={create:0,update:0,unchanged:0,retain:0,exclude:0,conflicts:0,changedSources:0,relationships:0,omittedRelationships:0,files:batch.files.length,bytes:batch.counts.bytes,dates:0,urls:0,figures:0,datasets:0,rows:0,assessments:0,preparations:0,executionEvents:0,criterionAssessments:0,resultStatements:0};
   await this.store.write('batches/'+batch.id,batch);return batchSummary(batch);
  });
 }
 async review(command,{signal}={}){
  const batch=await this.store.bound(command);if(batch.state!=='reviewing')return batchSummary(batch);
  const index=batch.order[batch.prepared];if(index===undefined)throw new AppError('IMPORT_DAMAGED');
  const row=await this.store.object(batch.id,index),target=link=>this.store.read('targets/'+batch.id+'/'+revisionKey(batch.source.namespace,link.id,link.revision),{optional:true});let prepared,problem;
  try{prepared=await this.workspace.catalogue(()=>prepareObject(this.store,batch,row,target,{signal}));}
  catch(error){if(!(error instanceof AppError))throw error;problem={code:error.code,details:error.details??[]};}
  return this.store.locked(async()=>{
   signal?.throwIfAborted();const current=await this.store.bound(command);
   if(current.edit!==batch.edit||current.prepared!==batch.prepared||current.state!=='reviewing')throw new AppError('IMPORT_CHANGED');
   for(const key of ['preparations','executionEvents','criterionAssessments','resultStatements'])current.reconciliation[key]??=0;
   row.prepared=prepared??null;row.problem=problem??null;row.reviewEdit=batch.edit;await this.store.putObject(batch.id,index,row);
   if(problem||prepared?.unresolved)current.problems++;
   if(prepared){
    const r=current.reconciliation;r[prepared.action]++;r.conflicts+=prepared.conflicts.length;r.changedSources+=Number(prepared.sourceChanged??false);
    r.dates+=row.source.dates.length;r.urls+=row.source.urls.length;
    if(prepared.action==='exclude')r.omittedRelationships+=row.source.links.length;
    else {
     r.relationships+=row.mapping.links.filter(l=>l.mode!=='omit').length;r.omittedRelationships+=row.mapping.links.filter(l=>l.mode==='omit').length;
     r.figures+=prepared.sourceRecord.figures.length;r.datasets+=Number(Boolean(prepared.dataset));r.rows+=prepared.dataset?.content.rowCount??0;r.assessments+=Number(row.source.mapping?.kind==='assessment');
     const facts=prepared.sourceRecord.attempt;r.preparations+=facts?.preparations.length??0;r.executionEvents+=facts?.events.length??0;r.criterionAssessments+=facts?.assessments.length??0;r.resultStatements+=prepared.sourceRecord.results?.statements.length??0;
    }
   }
   current.prepared++;
   if(current.prepared===current.count){current.state=current.problems?'mapping':'ready';current.review=current.problems?null:importHash({id:current.id,edit:current.edit,nonce:current.reviewNonce,reconciliation:current.reconciliation});}
   await this.store.write('batches/'+batch.id,current);return batchSummary(current);
  });
 }
 async commit(command,{signal,onProgress=()=>{}}={}){
  const selected=await this.store.bound(command);if(selected.state==='committed')return batchSummary(selected);
  if(selected.state!=='ready'||selected.review!==command.review)throw new AppError('IMPORT_REVIEW');
  for(let i=0;i<selected.files.length;i++){
   signal?.throwIfAborted();const original=await this.store.original(selected.files[i].sha256,{signal});if(original.size!==selected.files[i].bytes)throw new AppError('IMPORT_DAMAGED');
   await onProgress({phase:'verifying-originals',done:i+1,total:selected.files.length});
  }
  return this.store.locked(()=>this.workspace.catalogue(async catalogue=>{
   const batch=await this.store.bound(command);if(batch.state==='committed')return batchSummary(batch);
   if(batch.state!=='ready'||!hashValue(command.review)||batch.review!==command.review)throw new AppError('IMPORT_REVIEW');
   const head=await catalogue.head(),snapshot=await catalogue.indexed(await catalogue.snapshot(head)),index=new SnapshotIndex(catalogue);
   // Revalidate every reviewed identity before the first write. Independent
   // workspace activity is allowed; changed import targets require a new review.
   for(let i=0;i<batch.count;i++){
    signal?.throwIfAborted();const row=await this.store.object(batch.id,i),p=row.prepared;if(p.action==='exclude')continue;
    const identity=await this.store.read('identities/'+p.identityKey,{optional:true}),version=await this.store.read('revisions/'+p.versionKey,{optional:true});
    if(importHash(identity)!==importHash(p.previousIdentity)||importHash(version)!==importHash(p.previousVersion))throw new AppError('IMPORT_CHANGED');
    if(p.dataset&&importHash(await this.materials.current(p.dataset.id))!==importHash(p.dataset.previous))throw new AppError('IMPORT_CHANGED');
    if(row.mapping.current){const member=await catalogue.member(snapshot,p.sourceRecord.id);if((member?.revision??null)!==p.storedRevision)throw new AppError('IMPORT_CHANGED');}
    validateRecordChanges(snapshot.metadata,[p.sourceRecord],await index.validationRows(snapshot.membership,[p.sourceRecord]));
    if(p.record)validateRecordChanges(snapshot.metadata,[p.record],await index.validationRows(snapshot.membership,[p.record]));
   }
   const store=this.store,materials=this.materials,workspace=this.workspace,owned=[],materialChanges=[];
   async function* changes(){for(const i of batch.order){
    signal?.throwIfAborted();const row=await store.object(batch.id,i),p=row.prepared;if(p.action==='exclude')continue;
    await materials.retainRecord(p.sourceRecord);
    await validateAttemptChange(workspace,batch.workspaceId,null,p.sourceRecord);
    await validateResultSources(workspace,p.sourceRecord);
    if(p.record){await validateAttemptChange(workspace,batch.workspaceId,p.currentRecord,p.record);await validateResultSources(workspace,p.record);}
    if(p.record&&['create','update'].includes(p.action)){owned.push({index:i,id:p.record.id,before:p.storedRevision,after:recordRevision(p.record)});yield p.record;}
   }}
   if(batch.reconciliation.create+batch.reconciliation.update)await catalogue.commitChanges(head,snapshot,snapshot.metadata,changes());
   else for await(const record of changes()){void record;}
   const ownedIds=new Set(owned.map(change=>change.id));
   for(const i of batch.order){
    signal?.throwIfAborted();const row=await this.store.object(batch.id,i),p=row.prepared;if(p.action==='exclude')continue;
    if(p.previousVersion?.fingerprint!==p.fingerprint||recordRevision(p.previousVersion.sourceRecord)!==recordRevision(p.sourceRecord))await this.store.write('revisions/'+p.versionKey,{batchId:batch.id,index:i,fingerprint:p.fingerprint,sourceFingerprint:p.sourceFingerprint,sourceRecord:p.sourceRecord});
    if(row.mapping.current&&(!p.previousIdentity||p.previousIdentity.fingerprint!==p.fingerprint||recordRevision(p.previousIdentity.sourceRecord)!==recordRevision(p.sourceRecord)||p.action!=='unchanged')){
     await this.store.write('identities/'+p.identityKey,{batchId:batch.id,index:i,id:p.sourceRecord.id,createdAt:p.sourceRecord.createdAt,sourceRecord:p.sourceRecord,fingerprint:p.fingerprint});
     if(!ownedIds.has(p.record.id)){owned.push({index:i,id:p.record.id,before:p.storedRevision,after:recordRevision(p.record),changed:false});ownedIds.add(p.record.id);}
    }
    await this.store.write('record-sources/'+p.sourceRecord.id+'/'+batch.id+'-'+i,{batchId:batch.id,index:i,sourceId:row.source.id,sourceRevision:row.source.revision,namespace:batch.source.namespace});
    await attachImportedEvidence(store,materials,batch,row);
    await onProgress({phase:'committing',done:i+1,total:batch.count});
   }
   for(const i of batch.order){
    signal?.throwIfAborted();const row=await this.store.object(batch.id,i);if(!row.prepared?.dataset)continue;
    const change=await commitImportedDataset(materials,row.prepared.dataset,this.store,batch.id);if(change){
     const member=await catalogue.member(await catalogue.snapshot(),row.prepared.sourceRecord.id);
     materialChanges.push({...change,index:i,recordId:row.prepared.sourceRecord.id,recordRevision:recordRevision(await catalogue.record(member.id,member.revision))});
    }
    await onProgress({phase:'committing-datasets',done:i+1,total:batch.count});
   }
   batch.state='committed';batch.receipt={committedAt:new Date().toISOString(),etag:await catalogue.head(),owned,materialChanges};
   await this.store.write('batches/'+batch.id,batch);return batchSummary(batch);
  }));
 }
 async reverse(command,{signal}={}){
  return this.store.locked(()=>this.workspace.catalogue(async catalogue=>{
   const batch=await this.store.bound(command);if(batch.state==='reversed')return batchSummary(batch);
   if(batch.state!=='committed'||command.review!==batch.review)throw new AppError('IMPORT_REVIEW');
   const head=await catalogue.head(),snapshot=await catalogue.indexed(await catalogue.snapshot(head)),restore=[],removed=[],candidates=[],results=new Map(),counts={removed:0,restored:0,unchanged:0,'preserved-edits':0,'preserved-references':0,'preserved-facts':0,'already-absent':0};
   const result=(index,kind,id,disposition)=>{const row=results.get(index)??{};row[kind]={id,disposition};results.set(index,row);counts[disposition]++;};
   const editedDatasets=new Set();
   for(const change of batch.receipt.materialChanges??[]){
    signal?.throwIfAborted();const current=await this.materials.current(change.id);if(current&&current.revision!==change.after.revision)editedDatasets.add(change.recordId);
   }
   for(const change of batch.receipt.owned){
    signal?.throwIfAborted();const row=await this.store.object(batch.id,change.index),p=row.prepared,identity=await this.store.read('identities/'+p.identityKey,{optional:true}),member=await catalogue.member(snapshot,change.id);
    if(editedDatasets.has(change.id)||identity?.batchId!==batch.id||member&&recordRevision(await catalogue.record(change.id,member.revision))!==change.after){result(change.index,'record',change.id,'preserved-edits');continue;}
    if(!member){result(change.index,'record',change.id,'already-absent');continue;}
    if(change.changed!==false&&change.before){
     const record=await catalogue.record(change.id,change.before);
     if(!appendOnlyAttempt((await catalogue.record(change.id,member.revision)).attempt,record.attempt)){result(change.index,'record',change.id,'preserved-facts');continue;}
     try{validateRecordChanges(snapshot.metadata,[record],await new SnapshotIndex(catalogue).validationRows(snapshot.membership,[record]));}
     catch(error){if(!(error instanceof AppError))throw error;result(change.index,'record',change.id,'preserved-references');continue;}
    }
    if(change.changed!==false){if(change.before)restore.push({id:change.id,revision:change.before});else removed.push(change.id);}
    candidates.push(change);
   }
   const protectedIds=await protectedImportTargets(catalogue,snapshot,removed,restore,{signal});
   for(let i=removed.length-1;i>=0;i--)if(protectedIds.has(removed[i]))removed.splice(i,1);
   for(const change of candidates){
    if(protectedIds.has(change.id)){result(change.index,'record',change.id,'preserved-references');continue;}
    const p=(await this.store.object(batch.id,change.index)).prepared;
    if(p.previousIdentity)await this.store.write('identities/'+p.identityKey,p.previousIdentity);
    else await this.workspace.removeMetadata('.observanda/migration/identities/'+p.identityKey+'.json');
    result(change.index,'record',change.id,change.changed===false?'unchanged':change.before?'restored':'removed');
   }
   for(const change of batch.receipt.materialChanges??[]){
    signal?.throwIfAborted();const current=await this.materials.current(change.id),member=await catalogue.member(snapshot,change.recordId),disposition=results.get(change.index)?.record?.disposition;
    if(disposition?.startsWith('preserved-')||current?.revision!==change.after.revision||!member||recordRevision(await catalogue.record(change.recordId,member.revision))!==change.recordRevision){
     result(change.index,'material',change.id,disposition?.startsWith('preserved-')?disposition:'preserved-edits');continue;
    }
    const relative='.observanda/materials/objects/'+change.id+'/head.json';
    if(change.before){await this.workspace.writeMetadata(relative,JSON.stringify(change.before));await this.materials.index.changed(change.before,await this.materials.read(change.before));}
    else {await this.materials.index.removeHead(current);await this.workspace.removeMetadata(relative);}
    if(change.importedBefore)await this.store.write('datasets/'+change.id,change.importedBefore);else await this.workspace.removeMetadata('.observanda/migration/datasets/'+change.id+'.json');
    result(change.index,'material',change.id,change.before?'restored':'removed');
   }
   const metadata=snapshot.metadata;
   async function* records(){for(const ref of restore){signal?.throwIfAborted();yield await catalogue.record(ref.id,ref.revision);}}
   if(restore.length||removed.length){await catalogue.validateMetadata(snapshot,metadata,{removed});await catalogue.commitChanges(head,snapshot,metadata,records(),{removed});}
   for(const [index,value] of results){const row=await this.store.object(batch.id,index);row.reversal=value;await this.store.putObject(batch.id,index,row);}
   batch.state='reversed';batch.reversal={at:new Date().toISOString(),counts};await this.store.write('batches/'+batch.id,batch);return batchSummary(batch);
  }));
 }
 async page(command){const result=await this.store.page(command);return {...result,batch:batchSummary(result.batch)};}
 async list(command){const page=await this.store.list(command.workspaceId,{after:command.after??null});return {items:page.items.map(batchSummary),next:page.next};}
 async provenance(command){
  if(!importId(command.recordId))throw new AppError('INVALID');const {metadata}=await this.workspace.outline();if(command.workspaceId!==metadata.id)throw new AppError('WORKSPACE_CHANGED');
  const page=await this.workspace.metadataPage('.observanda/migration/record-sources/'+command.recordId,{after:command.after??null,limit:20}),items=[];
  for(const item of page.items){const ref=JSON.parse(item.text),batch=await this.store.batch(ref.batchId),row=await this.store.object(ref.batchId,ref.index);items.push({ref,batch:batchSummary(batch),source:{...row.source,...(row.prepared?.attributesText?{attributes:row.prepared.attributesText}:{})},mapping:row.mapping,conversion:row.prepared?.conversion});}
  return {items,next:page.next};
 }
 async download(command){
  const batch=await this.store.bound(command);if(command.index>=batch.count)throw new AppError('NOT_FOUND');const row=await this.store.object(batch.id,command.index),file=row.source.files[command.file];
  if(!Number.isInteger(command.file)||!file||batch.state==='staging')throw new AppError('NOT_FOUND');
  return {name:path.posix.basename(file.path),content:await this.store.original(file.sha256)};
 }
 async run(operation,command,options){
  if(operation==='evidenceReview')return this.workspace.catalogue(()=>new ImportEvidenceRepair(this.store,this.materials).plan(command,options));
  if(operation==='evidenceRepair')return new ImportEvidenceRepair(this.store,this.materials).apply(command,options);
  if(!['create','stage','detail','mapping','beginReview','review','commit','reverse','page','list','provenance'].includes(operation))throw new AppError('NOT_FOUND');
  return this[operation](command,options);
 }
}
