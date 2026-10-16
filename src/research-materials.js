import {artifactRelative,retiredArtifactContent} from './project-artifact-content.js';
import {materialKinds,validMaterialReference,materialReference,materialReferenceKey} from './web/material-reference.js';
import {workspaceReferenceNamespaceMatches} from './research-reference-namespace.js';
import {INTERVAL_FIELDS} from './web/figure-intervals.js';
// Private, revision-addressed research material. Original bytes never enter the
// workspace document or publication projection. Uses the existing encrypted I/O.
import path from 'node:path';
import {unlink,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {assertRegular,privateDirectory,digest} from './storage.js';
import {FileContent,writeContent,describeContent} from './file-content.js';
import {recordRevision} from './research.js';
import {materialRecordSummary} from './material-record-summary.js';
import {withRecordDocument} from './record-document.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {revisionText,revisionId} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
import {readDataset,datasetMapping,DATASET_LIMITS} from './dataset-reader.js';
import {createFigure,figureIssues} from './web/figure-model.js';
import {figurePlots} from './web/figure-composition.js';
import {sameFigureCalculation} from './web/figure-result-links.js';
import {figureSourceEntries,withoutFigureSources} from './web/figure-provenance.js';
import {createFigureMapper} from './web/figure-import-model.js';
import {PagedMedian} from './paged-median.js';
import {withMaterialTraversal} from './material-traversal.js';
import {MaterialUploadChunks} from './material-upload-chunks.js';
import {withWorkspaceMetadataBatch,metadataBatchIndex} from './metadata-batch.js';
import {MaterialIndex} from './material-index.js';
import {MaterialSequence} from './material-sequence.js';
import {MaterialDrafts} from './material-drafts.js';
import {MaterialChoices} from './material-choices.js';
import {EvidenceIntake} from './evidence-intake.js';
import {EvidenceAssociationBatches} from './evidence-association-batches.js';
import {EvidenceCorrections} from './evidence-corrections.js';
import {fileFingerprint} from './web/evidence-fingerprint.js';
import {REPRESENTATIONS,validQuantity,validTime,schemaReferences,supportedValue} from './web/measurement-model.js';
import {Measurements} from './measurements.js';
import {AnalysisComparisons} from './analysis-comparisons.js';
import {currentAttemptItems} from './web/attempt-model.js';
import {validAnalysisMethod,analysisMethodReferences} from './web/analysis-model.js';
import {validNativeMapping,nativeRowLocator} from './native-mapping.js';
import {exactRational} from './web/measurement-model.js';
import {compareRationalText,sumRationalText} from './web/measurement-reduction.js';
import {defaultColumn} from './web/dataset-schema.js';
import {DatasetCalculations} from './dataset-calculations.js';
import {DatasetAggregation,clearAggregationWork} from './dataset-aggregation.js';
import {aggregationMemberContext,aggregationMemberRows} from './dataset-aggregation-members.js';
import {RetainedRecordDocuments} from './retained-record-documents.js';

export const EVIDENCE_CHUNK=1024*1024;
const kinds=materialKinds;
const fail=code=>{throw new AppError(code??'MATERIAL_INVALID');};
const text=(v,max=1000)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const required=(v,max)=>text(v,max)&&v.trim();
export const materialRef=validMaterialReference;
const refOf=doc=>({kind:doc.kind,id:doc.id,revision:digest(revisionText(doc))});
function integerSpelling(value,radix=10){
 if(typeof value!=='string'||!Number.isInteger(radix)||radix<2||radix>36||! /^[+-]?[0-9a-z]+$/i.test(value))fail();
 const source=value.replace(/^[+-]/,'').toLowerCase();
 for(const digit of source)if(parseInt(digit,36)>=radix)fail();return source;
}
export function exactInteger(value,radix=10){
 const source=integerSpelling(value,radix);let result=0n;
 for(const digit of source)result=result*BigInt(radix)+BigInt(parseInt(digit,36));
 return value.startsWith('-')?-result:result;
}
export function validColumns(columns,width){
 return Array.isArray(columns)&&columns.length===width&&columns.every(c=>
  c&&required(c.name,200)&&REPRESENTATIONS.includes(c.representation)&&
  Number.isInteger(c.radix)&&c.radix>=2&&c.radix<=36&&text(c.unit,100)&&Array.isArray(c.missing)&&c.missing.length<=30&&
  c.missing.every(m=>m&&text(m.value,100)&&required(m.meaning,200))&&
  validTime(c.time)&&(c.quantity===undefined||validQuantity(c.quantity,c.unit)));
}
const figureFingerprint=figure=>digest(revisionText(withoutFigureSources(figure)));

export class ResearchMaterials {
 constructor(workspace){this.workspace=workspace;this.index=new MaterialIndex(this);this.sequences=new MaterialSequence(workspace);this.uploads=new MaterialUploadChunks(this.sequences);this.choices=new MaterialChoices(this);this.drafts=new MaterialDrafts(this);this.intakes=new EvidenceIntake(this);this.associations=new EvidenceAssociationBatches(this);this.measurements=new Measurements(this);this.comparisons=new AnalysisComparisons(this);}
 async directory(relative='',{create=true}={}){
  const parts=path.posix.join('.observanda','materials',relative);
  if(create)return privateDirectory(this.workspace.root,parts);
  let directory=this.workspace.root;
  for(const part of parts.split('/')){directory=path.join(directory,part);await assertRegular(directory,{directory:true});}
  return directory;
 }
 metadataFile(relative){return this.workspace.metadataPath('.observanda/materials/'+relative);}
 relative(file){return path.relative(this.workspace.root,file).split(path.sep).join('/');}
 async present(file){return (await this.workspace.readMetadata(this.relative(file),16*1024*1024))!==null;}
 async json(file,{missing=false}={}){const raw=await this.workspace.readMetadata(this.relative(file),16*1024*1024);if(raw===null){if(missing)return null;fail('MATERIAL_MISSING');}return JSON.parse(raw);}
 async put(file,data){await this.workspace.writeMetadata(this.relative(file),JSON.stringify(data)+'\n');}
 names(relative){return this.workspace.metadataNames('.observanda/materials/'+relative);}
 async assertOwner(recordId,{write=false}={}){
  if(!researchId(recordId))fail();
  if(await this.workspace.storageKind()!=='catalogue'){await this.owner(recordId);return;}
  await this.workspace.catalogue(async store=>{
   const head=await store.head(),check=async()=>{
    const snapshot=await store.snapshot(head),row=await store.member(snapshot,recordId);if(!row)fail();
    return JSON.stringify([row.notebookId??null,snapshot.metadata.notebooks.find(item=>item.id===row.notebookId)?.projectId??null]);
   };
   const cache=metadataBatchIndex(store)?.objectReads??store.readCache;
   const [notebookId,projectId]=JSON.parse(cache?await cache.proof('material-owner:'+head+':'+recordId,check):await check());
   // Membership belongs to the pinned research head. Write authority can change
   // independently, so read its live handover receipts on every write check.
   if(write&&!this.workspace.projectId&&notebookId){const {ProjectSourceAuthority}=await import('./project-source-authority.js');await new ProjectSourceAuthority(store).notebook(notebookId,{notebooks:projectId!==null?[{id:notebookId,projectId}]:[]});}
  });
 }
 async owner(recordId){
  if(!researchId(recordId))fail();
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(async store=>{
   const manifest=await store.snapshot(),member=await store.member(manifest,recordId);if(!member)fail();
   return {...manifest.metadata,entries:[await store.record(member.id,member.revision)]};
  });
  const {book}=await this.workspace.read();if(!book.entries.some(r=>r.id===recordId))fail();return book;
 }
 async retainRecord(record){
  const revision=recordRevision(record),file=this.metadataFile('records/'+record.id+'/'+revision+'.json');
  if(!await this.present(file))await this.put(file,record);
  return {kind:'record',id:record.id,revision};
 }
 async recordSummary(id){
  if(!researchId(id))fail();
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(async store=>{
   const snapshot=await store.snapshot(),row=await store.member(snapshot,id);if(!row)fail();
   return {workspaceId:snapshot.metadata.id,...await materialRecordSummary(store,row)};
  });
  const book=await this.owner(id),record=book.entries.find(value=>value.id===id);
  return {workspaceId:book.id,id,notebookId:record.notebookId,title:record.title,revision:recordRevision(record)};
 }
 // Automatic acquisition capture already holds the writer lock. It pins the
 // current version atomically with the upload or file-set receipt.
 async retainCurrentRecordLocked(id){
  if(await this.workspace.storageKind()==='catalogue'){
   const ref=await new RetainedRecordDocuments(this.workspace).pinLocked(id);if(ref)return {kind:ref.kind,id:ref.id,revision:ref.revision};
  }
  const book=await this.owner(id);return this.retainRecord(book.entries.find(record=>record.id===id));
 }
 async pinRecord(id,expectedRevision){
  if(!revisionId(expectedRevision))fail('MATERIAL_INVALID');
  return this.workspace.withLock(async()=>{
   if(await this.workspace.storageKind()==='catalogue'){
    const pinned=await new RetainedRecordDocuments(this.workspace).pinLocked(id,expectedRevision);if(pinned)return pinned;
   }
   const book=await this.owner(id),record=book.entries.find(r=>r.id===id),revision=recordRevision(record);
   if(expectedRevision!==revision)fail('RECORD_CHANGED');
   return {...await this.retainRecord(record),workspaceId:book.id};
  });
 }
 async read(ref){
  if(!materialRef(ref))fail();
  await this.assertReferenceWorkspace(ref);
  if(ref.kind==='record'&&await this.workspace.storageKind()==='catalogue')return new RetainedRecordDocuments(this.workspace).value(ref);
  const doc=await this.json(this.metadataFile((ref.kind==='record'?'records/':'objects/')+ref.id+'/'+ref.revision+'.json'));
  if((ref.kind==='record'?recordRevision(doc):digest(revisionText(doc)))!==ref.revision)fail('MATERIAL_MISSING');
  if(ref.kind!=='record'&&(doc.format!==1||doc.kind!==ref.kind||doc.id!==ref.id))fail('MATERIAL_MISSING');
  return doc;
 }
 async assertReferenceWorkspace(ref){
  if(!materialRef(ref)||!await workspaceReferenceNamespaceMatches(this.workspace,ref))fail();
 }
 async checkReference(ref,{signal}={}){
  await this.assertReferenceWorkspace(ref);
  if(ref?.kind==='record'&&await this.workspace.storageKind()==='catalogue')return new RetainedRecordDocuments(this.workspace).check(ref,{signal});
  await this.read(ref);
 }
 async *headEntries(){
  for await(const id of this.names('objects')){if(!researchId(id))continue;
   const head=await this.current(id);if(head)yield head;
  }
 }
 async heads(){return Array.fromAsync(this.headEntries());}
 async current(id){if(!researchId(id))fail();const head=await this.json(this.metadataFile('objects/'+id+'/head.json'),{missing:true});if(head!==null&&(!materialRef(head)||head.id!==id))fail('MATERIAL_MISSING');return head;}
 // Call under the workspace lock. Revision and head share the metadata transaction.
 async commit({kind,recordId,title,content,id=randomUUID(),expectedRevision=null}){
  if(!kinds.includes(kind)||!researchId(id)||!required(title,300))fail();
  await this.assertOwner(recordId,{write:true});await this.index.ensureLocked();
  const headFile=this.metadataFile('objects/'+id+'/head.json'),previous=await this.json(headFile,{missing:true});
  if((previous?.revision??null)!==expectedRevision||previous&&(previous.kind!==kind||previous.recordId!==recordId))fail('MATERIAL_CHANGED');
  const doc={format:1,kind,id,recordId,title,createdAt:new Date().toISOString(),previous:previous?.revision??null,content};
  if(Buffer.byteLength(JSON.stringify(doc))+1>16*1024*1024)fail('LIMIT');
  const ref=refOf(doc),file=this.metadataFile('objects/'+id+'/'+ref.revision+'.json');
  await this.put(file,doc);
  const head={...ref,recordId,title,createdAt:doc.createdAt,...this.referenceSet(content),figureHash:content.figure?figureFingerprint(content.figure):null,figureId:content.figure?.id??null};
  await this.put(headFile,head);await this.index.changed(head,doc);
  return ref;
 }
 async startImport(command){return this.workspace.withLock(()=>this.startImportLocked(command));}
 async startImportLocked({recordId,name,size,provenance='',derivesFrom=[]},batch={}){
  if(!required(name,255)||/[\\/:]/.test(name)||!Number.isSafeInteger(size)||size<0||!text(provenance,10000)||!Array.isArray(derivesFrom)||derivesFrom.length>50||!derivesFrom.every(materialRef))fail();
   await this.assertOwner(recordId,{write:true});let acquisition=batch.acquisition;
   if(acquisition)await this.assertOwner(recordId);
   else acquisition=await this.retainCurrentRecordLocked(recordId);
   await this.index.ensureLocked();for(const ref of derivesFrom)await this.checkReference(ref);
   const id=randomUUID();
   const session={id,recordId,name,size,provenance,derivesFrom,acquisition,chunkSize:EVIDENCE_CHUNK,...this.uploads.initial(),createdAt:new Date().toISOString(),completed:null,...batch};
   await this.put(this.metadataFile('imports/'+id+'/session.json'),session);await this.index.addImport(session);return session;
 }
 async importState(id){if(!researchId(id))fail();return this.uploads.validate(await this.json(this.metadataFile('imports/'+id+'/session.json')));}
 async imports(recordId){
  await this.assertOwner(recordId);const out=[];
  for await(const id of this.names('imports')){if(researchId(id)){const item=await this.importState(id);if(item.recordId===recordId&&!item.completed)out.push(item);}}
  return out;
 }
 async appendImport(id,index,source,{signal}={}){
  return this.workspace.withLock(()=>this.appendImportLocked(id,index,source,{signal}));
 }
 async appendImportLocked(id,index,source,{signal}={}){
  return withWorkspaceMetadataBatch(this.workspace,async()=>{
   const session=await this.importState(id);await this.assertOwner(session.recordId,{write:true});
   if(session.batchId&&((await this.intakes.authorized(session.batchId)).state!=='open'||session.reuse))fail('MATERIAL_CHANGED');
   if(session.completed||!Number.isInteger(index)||index<0||index!==this.uploads.count(session))fail('MATERIAL_CHANGED');
   const expected=Math.min(EVIDENCE_CHUNK,session.size-index*EVIDENCE_CHUNK);if(expected<=0)fail();
   const file=path.join(await this.directory('imports/'+id),index+'.chunk');
   const result=await writeContent(this.workspace,file,source,{maxBytes:expected,signal});
   if(result.size!==expected)fail('MATERIAL_INCOMPLETE');
   await this.uploads.append(session,result);
   if(session.fingerprint&&this.uploads.count(session)===Math.ceil(session.size/EVIDENCE_CHUNK)&&await fileFingerprint(session.size,this.uploads.entries(session),digest)!==session.fingerprint)fail('MATERIAL_SOURCE_CHANGED');
   if(session.batchId&&this.uploads.count(session)===Math.ceil(session.size/EVIDENCE_CHUNK))await this.intakes.uploadedLocked(session);
   await this.put(path.join(path.dirname(file),'session.json'),session);return session;
  });
 }
 async withUploadChunks(session,consume,options={}){
  const {withRetiredUploadChunks,retainedUploadChunks}=await import('./project-upload-content.js');
  const retired=await withRetiredUploadChunks(this.workspace,session,consume,options);if(retired)return retired.value;
  return consume(retainedUploadChunks({workspace:this.workspace},session,options));
 }
 async prepareImport(id,{signal,progress=async()=>{},storageId=randomUUID()}={}){
  if(!researchId(storageId))fail();const session=await this.importState(id);await this.assertOwner(session.recordId,{write:true});
  if(session.completed)return {completed:session.completed};
  if(this.uploads.bytes(session)!==session.size)fail('MATERIAL_INCOMPLETE');
  return this.withUploadChunks(session,async parts=>{
   let done=0;async function* chunks(){for await(const part of parts){signal?.throwIfAborted();yield part.bytes;done+=part.receipt.size;await progress({stage:'verifying',done,total:session.size,unit:'bytes'});}}
   const folder=await this.directory('originals/'+id),result=await writeContent(this.workspace,path.join(folder,storageId+'.original'),chunks(),{maxBytes:session.size,signal});
   signal?.throwIfAborted();return {...result,storageId,sessionHash:digest(JSON.stringify(session))};
  },{signal});
 }
 // The caller holds the workspace transaction, including the worker lease fence.
 async commitImport(id,prepared,{cleanup=true}={}){
  const session=await this.importState(id);if(session.completed)return session.completed;
  if(!researchId(prepared.storageId)||prepared.sessionHash!==digest(JSON.stringify(session))||prepared.size!==session.size)fail('MATERIAL_CHANGED');
  const originalId=prepared.originalId??id;if(!researchId(originalId))fail('MATERIAL_CHANGED');
  const file=path.join(await this.directory('originals/'+originalId,{create:false}),prepared.storageId+'.original');await assertRegular(file);
  const ref=await this.commit({kind:'artifact',id,recordId:session.recordId,title:session.name,content:{name:session.name,size:prepared.size,sha256:prepared.sha256,storageId:prepared.storageId,...(session.batchId?{originalId,fingerprint:session.fingerprint,intakeId:session.batchId}:{}),...(session.sourcePath?{sourcePath:session.sourcePath}:{}),...(session.sourcePurpose?{sourcePurpose:session.sourcePurpose}:{}),provenance:session.provenance,acquisition:session.acquisition,inputs:session.derivesFrom}});
  session.completed=ref;await this.put(this.metadataFile('imports/'+id+'/session.json'),session);await this.index.finishImport(session);
  if(cleanup)await this.workspace.afterCommit(()=>this.readSnapshot(()=>this.cleanImport(session)).catch(()=>{}));return ref;
 }
 async cleanAttempts(id,{only=null}={}){
  const session=await this.importState(id),folder=await this.directory('originals/'+id);
  const manifest=session.completed?await this.read(session.completed):null;
  const retained=manifest?(manifest.content.storageId?manifest.content.storageId+'.original':'original'):null;
  for(const name of await readdir(folder)){
   if(name===retained||only&&name!==only+'.original'||!/^([a-f0-9-]{36}\.original|\.stream-[a-f0-9-]{36})$/.test(name))continue;
   try{const file=path.join(folder,name);if(await assertRegular(file,{missing:true}))await unlink(file);}catch{/* An interrupted attempt may still hold its file; later cleanup is safe. */}
  }
 }
 async cleanImport(session){
  await this.cleanAttempts(session.id);
  // Only remove known uploaded chunks after the original's manifest is durable.
  for(let i=0;i<this.uploads.count(session);i++){
   const file=path.join(await this.directory('imports/'+session.id),i+'.chunk');
   try{if(await assertRegular(file,{missing:true}))await unlink(file);}catch{/* A repeated finalization can retry cleanup. */}
  }
 }
 async finishImport(id,{signal}={}){
  // Service callers use the durable worker. Direct commands share the same
  // preparation/commit implementation and retain their synchronous result API.
  if((await this.importState(id)).batchId)fail('MATERIAL_CHANGED');
  const prepared=await this.prepareImport(id,{signal});
  return this.workspace.withLock(async()=>{signal?.throwIfAborted();return this.commitImport(id,prepared);});
 }
 async artifactPath(doc){
  const relative=artifactRelative(doc),parts=relative.split('/');
  return path.join(await this.directory(parts.slice(2,-1).join('/'),{create:false}),parts.at(-1));
 }
 async originalContent(doc){
  const retired=await retiredArtifactContent(this.workspace,doc);if(retired)return retired;
  const file=await this.artifactPath(doc);await assertRegular(file);return new FileContent(this.workspace,file,doc.content.size,doc.content.sha256);
 }
 async artifact(ref,{signal}={}){
  if(ref?.kind!=='artifact')fail();const doc=await this.read(ref),content=await this.originalContent(doc);
  // The retained descriptor already owns the expected size and digest. Check
  // both in one authenticated pass, including the stable-file check.
  try{await content.verify({signal});}catch(error){if(error.code==='MEDIA_INVALID')fail('MATERIAL_MISSING');throw error;}
  return {doc,content};
 }
 async previewDataset(command,{signal}={}){
  if(command.aggregation)return new DatasetAggregation(this).preview(command,{signal});
  if(command.calculation)return new DatasetCalculations(this).preview(command,{signal});
  await this.validateDataset(command);const source=await this.artifact(command.artifact,{signal}),rows=[];let columns=[];
  for await(const item of readDataset(source.content.read(0,source.content.size-1,{signal}),command.sourceMapping,{signal,size:source.content.size})){
   if(item.columns)columns=item.columns;else rows.push(item);
   if(rows.length===5)break;
  }
  return {columns,rows};
 }
 async validateDataset(command){
  if(command.aggregation)return new DatasetAggregation(this).validate(command);
  if(command.calculation)return new DatasetCalculations(this).validate(command);
  const {artifact,recordId,title,id,expectedRevision}=command;
  if(!materialRef(artifact)||!command.baseDataset&&artifact.kind!=='artifact'||!required(title,300)||id!==undefined&&!researchId(id)||expectedRevision!==undefined&&expectedRevision!==null&&!revisionId(expectedRevision))fail();
  if(!command.baseDataset)datasetMapping(command.sourceMapping);
  if(command.nativeMapping!==undefined){if(!validNativeMapping(command.nativeMapping))fail();await this.read(command.nativeMapping.artifact);}
  if(command.baseDataset){
   if(command.baseDataset.kind!=='dataset'||!materialRef(command.baseDataset)||command.baseDataset.id!==id||command.baseDataset.revision!==expectedRevision)fail();
   const base=await this.read(command.baseDataset);
   if(revisionText(base.content.inputs[0])!==revisionText(artifact)||base.recordId!==recordId)fail();
   if(command.sourceMapping&&revisionText(base.content.calculation||base.content.aggregation?command.sourceMapping:datasetMapping(command.sourceMapping))!==revisionText(base.content.sourceMapping??{format:'delimited',delimiter:base.content.delimiter,header:true}))fail();
  }
  await this.assertOwner(recordId);await this.read(artifact);
  if(id){const current=await this.current(id);if((current?.revision??null)!==(expectedRevision??null)||current&&(current.kind!=='dataset'||current.recordId!==recordId))fail('MATERIAL_CHANGED');}
  if(command.columns!==undefined&&(!Array.isArray(command.columns)||command.columns.length>DATASET_LIMITS.columns||!validColumns(command.columns,command.columns.length)))fail();
  if(command.columnChanges!==undefined&&(!command.baseDataset||command.columns!==undefined||!Array.isArray(command.columnChanges)||command.columnChanges.length>DATASET_LIMITS.columns||new Set(command.columnChanges.map(c=>c?.index)).size!==command.columnChanges.length||command.columnChanges.some(c=>!c||!Number.isInteger(c.index)||c.index<0||!validColumns([c.column],1))))fail();
  if(command.exclusions!==undefined&&(!command.exclusions||typeof command.exclusions!=='object'||Array.isArray(command.exclusions)||Object.values(command.exclusions).some(v=>!(command.baseDataset&&v===null)&&!required(v,1000))))fail();
  for(const column of [...command.columns??[],...(command.columnChanges??[]).map(c=>c.column)])for(const ref of schemaReferences(column))await this.checkReference(ref);
 }
 async prepareDataset(command,{signal,progress=async()=>{},writePage,jobId=null}={}){
  if(command.aggregation)return new DatasetAggregation(this).prepare(command,{signal,progress,writePage,jobId});
  if(command.calculation)return new DatasetCalculations(this).prepare(command,{signal,progress,writePage});
  await this.validateDataset(command);
  const base=command.baseDataset?await this.read(command.baseDataset):null;
  const source=base?{doc:{id:command.artifact.id}}:await this.artifact(command.artifact,{signal});
  return this.prepareDatasetRows(command,{source,base,signal,progress,writePage});
 }
 // Shared bounded builder. Callers validate their ownership contract first:
 // ordinary evidence uses an existing owner; staged imports have not created
 // that owner yet and bind these immutable pages in their eventual transaction.
 async prepareDatasetRows(command,{source,base=null,signal,progress=async()=>{},writePage,columnDefaults=defaultColumn,nativeSize:declaredNativeSize,rows:preparedRows,calculatedColumns,inputReferences}={}){
  const exclusions=command.exclusions??{},seen=new Set(),baseColumns=base?await this.datasetColumns(base):null;
  const nativeMapping=command.nativeMapping??base?.content.nativeMapping,nativeSize=nativeMapping?(declaredNativeSize??(await this.read(nativeMapping.artifact)).content.size):null;
  const self=this;
  async function* retained(){
   yield {columns:baseColumns.map(c=>c.name),sourceMapping:base.content.sourceMapping??{format:'delimited',delimiter:base.content.delimiter,header:true}};
   let order=0;
   for await(const row of self.iterateDataset(command.baseDataset)){
    signal?.throwIfAborted();yield {...row,order:++order,locator:row.locator??{format:'delimited',line:row.line}};
    await progress({stage:'validating dataset rows',done:order,total:base.content.rowCount});
   }
  }
  let columns,page=[],pageBytes=3,count=0,sourceMapping,aggregationMembersIndex=base?.content.aggregationMembersIndex;
  const save=writePage??(fn=>this.workspace.withLock(fn)),pages=this.sequences.builder('pages',save);
  const flush=async()=>{
   if(!page.length)return;
   const hash=digest(revisionText(page)),file=this.metadataFile('tables/'+hash+'.json'),rows=page;
   await save(async()=>{
    signal?.throwIfAborted();
    if(await this.present(file)){if(digest(revisionText(await this.json(file)))!==hash)fail('MATERIAL_MISSING');}
    else await this.put(file,rows);
   });
   await pages.append({hash,count:rows.length});page=[];pageBytes=3;
  };
  for await(const item of preparedRows??(base?retained():readDataset(source.content.read(0,source.content.size-1,{signal}),command.sourceMapping,{signal,progress,size:source.content.size}))){
   if(item.columns){
    columns=calculatedColumns??command.columns??baseColumns??item.columns.map(label=>columnDefaults({label}));
    for(const change of command.columnChanges??[]){if(change.index>=columns.length)fail();columns[change.index]=change.column;}
    if(!validColumns(columns,item.columns.length))fail();sourceMapping=item.sourceMapping;aggregationMembersIndex=item.aggregationMembersIndex??aggregationMembersIndex;continue;
   }
   const id=item.id??source.doc.id+':'+(item.locator.format==='delimited'?item.line:item.order),excluded=Object.hasOwn(exclusions,id)?exclusions[id]:item.excluded??null;
   if(Object.hasOwn(exclusions,id))seen.add(id);
   const row={id:item.id??id,line:item.line??item.order,cells:item.cells,excluded,order:item.order,locator:item.locator,...(item.valueKinds?{valueKinds:item.valueKinds}:{}),...(item.cellPointers?{cellPointers:item.cellPointers}:{}),...(item.cellSources?{cellSources:item.cellSources}:{}),...(item.aggregation?{aggregation:item.aggregation}:{}),...(item.aggregationMembers?{aggregationMembers:item.aggregationMembers}:{})};
   if(nativeMapping)row.nativeSelector=nativeRowLocator(nativeMapping,row,nativeSize).selector;
   for(const [i,column] of columns.entries()){
    const value=row.cells[i];if(['null','absent'].includes(row.valueKinds?.[i])||column.missing.some(m=>m.value===value))continue;
    if(!supportedValue(value,column.representation,column.radix))fail();
   }
   const bytes=Buffer.byteLength(JSON.stringify(row));if(bytes+3>DATASET_LIMITS.pageBytes)fail('MATERIAL_TABLE');
   if(page.length===DATASET_LIMITS.pageRows||pageBytes+bytes+(page.length?1:0)>DATASET_LIMITS.pageBytes)await flush();
   pageBytes+=bytes+(page.length?1:0);page.push(row);count++;if(!Number.isSafeInteger(count))fail('MATERIAL_DATASET_LIMIT');
  }
  await flush();if(Object.keys(exclusions).length!==seen.size)fail();
  signal?.throwIfAborted();
  const schema=this.sequences.builder('columns',save);for(const column of columns)await schema.append(column);
  const pageIndex=await pages.finish(),schemaIndex=await schema.finish();signal?.throwIfAborted();
  const inputs=[...new Map([...(inputReferences??base?.content.inputs??[command.artifact]),...columns.flatMap(schemaReferences),...(nativeMapping?[nativeMapping.artifact]:[])].map(r=>[materialReferenceKey(r),r])).values()];
  const calculation=command.calculation??base?.content.calculation;
  const aggregation=command.aggregation??base?.content.aggregation;
  return {commandHash:digest(revisionText(command)),content:{datasetFormat:2,inputs,schemaIndex,pageIndex,rowCount:count,sourceMapping,...(calculation?{calculation,algorithm:'observanda-retained-calculations',algorithmVersion:1}:{}),...(aggregation?{aggregation,algorithm:'observanda-retained-aggregation',algorithmVersion:1}:{}),...(aggregationMembersIndex?{aggregationMembersIndex}:{}),...(nativeMapping?{nativeMapping}:{}),delimiter:sourceMapping.delimiter??null,encoding:'UTF-8',order:aggregation?'first-group-occurrence':'acquisition'}};
 }
 async commitDataset(command,prepared){
  if(prepared.commandHash!==digest(revisionText(command)))fail('MATERIAL_CHANGED');
  await this.validateDataset(command);
  const {recordId,title,id,expectedRevision}=command;
  const result=await this.commit({kind:'dataset',recordId,title,id,expectedRevision,content:prepared.content});
  if(prepared.aggregationWorkId)await clearAggregationWork(this.workspace,prepared.aggregationWorkId);
  return result;
 }
 async dataset(command,options={}){
  const prepared=await this.prepareDataset(command,options);
  return this.workspace.withLock(()=>this.commitDataset(command,prepared));
 }
 datasetPageCount(doc){
  if(doc.kind!=='dataset')fail();
  if(doc.content.datasetFormat===2){this.sequences.validate(doc.content.pageIndex);this.sequences.validate(doc.content.schemaIndex);if(doc.content.pageIndex.kind!=='pages'||doc.content.schemaIndex.kind!=='columns'||doc.content.schemaIndex.count>DATASET_LIMITS.columns)fail('MATERIAL_MISSING');return doc.content.pageIndex.count;}
  if(doc.content.datasetFormat!==undefined||!Array.isArray(doc.content.pages)||!Array.isArray(doc.content.columns))fail('MATERIAL_MISSING');return doc.content.pages.length;
 }
 async schemaPage(ref,{offset=0,limit=16}={}){
  if(ref?.kind!=='dataset')fail();return this.retainedSchemaPage(await this.read(ref),{offset,limit});
 }
 async retainedSchemaPage(doc,{offset=0,limit=16}={}){
  this.datasetPageCount(doc);
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>DATASET_LIMITS.columns)fail();
  const page=doc.content.datasetFormat===2?await this.sequences.page(doc.content.schemaIndex,{offset,limit}):{items:doc.content.columns.slice(offset,offset+limit),offset,total:doc.content.columns.length,next:offset+limit<doc.content.columns.length?offset+limit:null};
  if(!validColumns(page.items,page.items.length))fail('MATERIAL_MISSING');return page;
 }
 async datasetColumns(doc){
  this.datasetPageCount(doc);if(doc.content.datasetFormat!==2)return doc.content.columns;
  const result=await this.sequences.page(doc.content.schemaIndex,{limit:DATASET_LIMITS.columns});
  if(!validColumns(result.items,result.total))fail('MATERIAL_MISSING');return result.items;
 }
 async datasetPage(ref,page=0,{columnOffset=null,columnLimit=16}={}){
  if(ref?.kind!=='dataset'||!Number.isInteger(page)||page<0)fail();
  const doc=await this.read(ref),result=await this.retainedDatasetPage(doc,page);
  if(columnOffset===null)return {...result,columns:await this.datasetColumns(doc)};
  const schema=await this.retainedSchemaPage(doc,{offset:columnOffset,limit:columnLimit}),columns=schema.items;
  if(!Number.isInteger(columnOffset)||columnOffset<0||columnOffset>=schema.total||!Number.isInteger(columnLimit)||columnLimit<1||columnLimit>32)fail();
  return {...result,columns,columnOffset,columnCount:schema.total,
   rows:result.rows.map(row=>({...row,cells:row.cells.slice(columnOffset,columnOffset+columnLimit),...(row.valueKinds?{valueKinds:row.valueKinds.slice(columnOffset,columnOffset+columnLimit)}:{})}))};
 }
 async retainedDatasetPage(doc,page){
  const pages=this.datasetPageCount(doc);
  if(!pages&&page===0&&doc.content.rowCount===0)return {rows:[],page,pages:0,rowCount:0};
  const info=doc.content.datasetFormat===2?await this.sequences.item(doc.content.pageIndex,page):doc.content.pages[page];if(!info)fail();
  if(!revisionId(info.hash)||!Number.isSafeInteger(info.count)||info.count<1||info.count>DATASET_LIMITS.pageRows)fail('MATERIAL_MISSING');
  const rows=await this.json(this.metadataFile('tables/'+info.hash+'.json'));
  if(digest(revisionText(rows))!==info.hash||rows.length!==info.count)fail('MATERIAL_MISSING');
  return {rows,page,pages,rowCount:doc.content.rowCount};
 }
 async *iterateDataset(ref){
  if(ref?.kind!=='dataset')fail();const doc=await this.read(ref);let count=0;
  for(let i=0;i<this.datasetPageCount(doc);i++)for(const row of (await this.retainedDatasetPage(doc,i)).rows){count++;yield row;}
  if(count!==doc.content.rowCount)fail('MATERIAL_MISSING');
 }
 // Bounded convenience reader for callers explicitly requesting a small table.
 async datasetRows(ref,{maxBytes=16*1024*1024}={}){const rows=[];let bytes=0;for await(const row of this.iterateDataset(ref)){bytes+=Buffer.byteLength(JSON.stringify(row));if(bytes>maxBytes)fail('MATERIAL_PLOT_LIMIT');rows.push(row);}return rows;}
 referenceSet(content,slot='inputs'){
  if(!['inputs','outputs'].includes(slot))fail();
  const provenance=slot==='inputs'?(content.method?analysisMethodReferences(content.method):content.provenanceInputs??[]):[];
  if(!Array.isArray(provenance)||!provenance.every(materialRef))fail('MATERIAL_MISSING');
  const extra=provenance.length?{provenanceInputs:provenance}:{};
  const index=content[slot+'Index'];
  if(index!==undefined){this.sequences.validate(index);if(index.kind!=='references'||content[slot]!==undefined)fail('MATERIAL_MISSING');return {[slot+'Index']:index,...extra};}
  const items=content[slot]??[];if(!Array.isArray(items)||!items.every(materialRef))fail('MATERIAL_MISSING');return {[slot]:items,...extra};
 }
 async *references(content,slot='inputs'){
  const set=this.referenceSet(content,slot),index=set[slot+'Index'];
  yield* set.provenanceInputs??[];
  if(!index){yield* set[slot];return;}
  for await(const item of this.sequences.items(index)){if(!materialRef(item))fail('MATERIAL_MISSING');yield item;}
 }
 async readSnapshot(operation){
  if(await this.workspace.storageKind()!=='catalogue')return operation();
  // Build derived discovery state before pinning the repeatable read. A writer
  // opened from inside that read cannot make new index markers visible to it.
  await this.index.ensure();return this.workspace.catalogue(operation);
 }
 async referencePage(ref,{slot='inputs',offset=0,limit=20}={}){
  return this.readSnapshot(async()=>{
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)fail();
  const doc=await this.read(ref);if(ref.kind==='record')fail();
  const set=this.referenceSet(doc.content,slot),index=set[slot+'Index'];
  if(!index&&offset>set[slot].length)fail();
  const page=index?await this.sequences.page(index,{offset,limit}):{items:set[slot].slice(offset,offset+limit),offset,total:set[slot].length,next:offset+limit<set[slot].length?offset+limit:null};
  return this.describeReferences(page);
  });
 }
 async describeReferences(page){
  const items=[];for(const ref of page.items){const doc=ref.kind==='record'&&await this.workspace.storageKind()==='catalogue'?await new RetainedRecordDocuments(this.workspace).summary(ref):await this.read(ref);items.push({...ref,title:doc.title});}return {...page,items};
 }
 async retainReferences(items,{outputs=false}={}){
  if(!Array.isArray(items))fail();
  if(items.length>64)fail('MATERIAL_REFERENCE_LIMIT');
  if(!items.every(materialRef)||outputs&&items.some(r=>r.kind!=='artifact'))fail();
  const builder=this.sequences.builder('references',fn=>fn()),seen=new Set();
  for(const ref of items){await this.checkReference(ref);const item=materialReference(ref),key=materialReferenceKey(item);if(seen.has(key))fail('MATERIAL_DUPLICATE');seen.add(key);await builder.append(item);}
  return builder.finish();
 }
 async collection(command){
  return this.workspace.withLock(async()=>{
   const inputsIndex=await this.retainReferences(command.inputs);
   return this.commit({...command,kind:'collection',content:{inputsIndex}});
  });
 }
 async analysis(command){
  return this.workspace.withLock(()=>this.analysisLocked(command));
 }
 async analysisLocked(command){
   const {inputs,tool,version,parameters,outputs=[],method,toolSha256,...identity}=command;
   if(!Array.isArray(inputs)||!inputs.length||!required(tool,200)||!required(version,200)||!text(parameters,20000))fail();
   if(method!==undefined&&!validAnalysisMethod(method))fail('ANALYSIS_INVALID');
   if(toolSha256!==undefined&&!revisionId(toolSha256))fail('ANALYSIS_INVALID');
   const refs=[...new Map([...inputs,...(method?analysisMethodReferences(method):[])].map(r=>[materialReferenceKey(r),r])).values()];
   const inputsIndex=await this.retainReferences(refs),outputsIndex=await this.retainReferences(outputs,{outputs:true});
   return this.commit({...identity,kind:'analysis',content:{inputsIndex,tool,version,parameters,outputsIndex,...(method?{method}:{}),...(toolSha256?{toolSha256}:{})}});
 }
 async validatePlot(command){
  const {recordId,title,id,expectedRevision,dataset,mapping,base}=command;
  if(mapping?.numericPolicy!==undefined&&!['safe','approximate'].includes(mapping.numericPolicy))fail();
  if(!required(title,300)||id!==undefined&&!researchId(id)||expectedRevision!==undefined&&expectedRevision!==null&&!revisionId(expectedRevision)||dataset?.kind!=='dataset'||!materialRef(dataset)||!mapping||!Array.isArray(mapping.values)||mapping.values.length>50||mapping.values.some(v=>!v||!Number.isInteger(v.column)||v.error!==null&&!Number.isInteger(v.error)||[...INTERVAL_FIELDS,'count'].some(k=>v[k]!=null&&!Number.isInteger(v[k]))))fail();
  await this.assertOwner(recordId);const doc=await this.read(dataset);
  if(id){const current=await this.current(id);if((current?.revision??null)!==(expectedRevision??null)||current&&(current.kind!=='analysis'||current.recordId!==recordId))fail('MATERIAL_CHANGED');}
  if(base&&(base.kind==='panels'||figureIssues({...base,series:createFigure().series},{draft:true}).length))fail();
  const cols=await this.datasetColumns(doc);for(const v of mapping.values)for(const k of ['error',...INTERVAL_FIELDS])if(v[k]!=null&&cols[v[k]]?.unit!==cols[k[0]==='x'?mapping.x:v.column]?.unit)fail();
  const mapper=createFigureMapper({columns:(await this.datasetColumns(doc)).map((c,index)=>({index,label:c.name,heading:c.name}))},{...mapping,mode:'replace',decimal:'.'},base??createFigure());
  if(mapper.invalid)fail();
  return doc;
 }
 plotWork(id,attempt){
  if(!researchId(id)||attempt!==undefined&&!researchId(attempt))fail();
  return '.observanda/analysis-work/'+id+(attempt?'/'+attempt:'');
 }
 async cleanPlotWork(id,attempt,write=fn=>this.workspace.withLock(fn)){
  const prefix=this.plotWork(id,attempt);
  if(await this.workspace.storageKind()==='catalogue'){
   for(;;){
    const batch=await this.workspace.metadataPage(prefix,{limit:50});if(!batch.items.length)return;
    await write(async()=>{for(const {name} of batch.items)await this.workspace.removeMetadata(prefix+'/'+name);});
   }
  }else{
   const folder=this.workspace.metadataPath(prefix);
   if(!await assertRegular(folder,{directory:true,missing:true}))return;
   for(const name of await readdir(folder)){
    if(!attempt&&researchId(name))await this.cleanPlotWork(id,name,write);
    else if(/^\d+(?:-\d+)?\.json$/.test(name))await write(()=>this.workspace.removeMetadata(prefix+'/'+name));
    else fail('UNSAFE');
   }
  }
 }
 async preparePlot(command,{signal,progress=async()=>{},writePage,attempt=randomUUID(),jobId=command.id??randomUUID()}={}){
  const doc=await this.validatePlot(command),columns=await this.datasetColumns(doc),{mapping,dataset}=command,operation=mapping.operation??'raw';
  const write=writePage??(fn=>this.workspace.withLock(fn)),prefix=this.plotWork(jobId,attempt);
  const median=mapping.operation==='median'?new PagedMedian({
   signal,progress,compareValues:compareRationalText,midpoint:(a,b)=>sumRationalText(a,b,2n),pageBytes:512*1024,
   read:name=>this.workspace.readMetadata(prefix+'/'+name,1024*1024),
   write:(name,text)=>write(async()=>{signal?.throwIfAborted();await this.workspace.writeMetadata(prefix+'/'+name,text);}),
   remove:async names=>{for(let i=0;i<names.length;i+=50)await write(async()=>{signal?.throwIfAborted();for(const name of names.slice(i,i+50))await this.workspace.removeMetadata(prefix+'/'+name);});}
  }):null;
  const mapper=createFigureMapper({columns:columns.map((c,index)=>({index,label:c.name+(c.unit?' ('+c.unit+')':''),heading:c.name}))},{...mapping,mode:'replace',decimal:'.'},command.base??createFigure(),{median,limits:{series:256,points:10000,characters:262144},parseNumber:(raw,index)=>{
   const column=columns[index];try{return exactRational(raw,column.representation,column.radix);}catch{fail('MATERIAL_PRECISION');}
  }});
  const denominator={format:2,dataset,rows:0,included:0,excludedCount:0,missing:columns.map((c,column)=>({column,name:c.name,count:0}))};
  try{
   for(let page=0;page<this.datasetPageCount(doc);page++){
    signal?.throwIfAborted();
    for(const row of (await this.retainedDatasetPage(doc,page)).rows){
     signal?.throwIfAborted();denominator.rows++;
     if(row.excluded){denominator.excludedCount++;continue;}
     denominator.included++;
     const cells=row.cells.map((raw,i)=>{
      const col=columns[i];
      if(['null','absent'].includes(row.valueKinds?.[i])||col.missing.some(m=>m.value===raw)){denominator.missing[i].count++;return '';}
      return raw;
     });
     mapper.add({line:row.line,cells});
     if(mapper.invalid){const result=mapper.finish();fail(result.limited?'MATERIAL_ANALYSIS_LIMIT':result.precision?'MATERIAL_PRECISION':'MATERIAL_INVALID');}
     await median?.flush();
    }
    await progress({stage:'calculating dataset rows',done:denominator.rows,total:doc.content.rowCount});
   }
   if(denominator.rows!==doc.content.rowCount)fail('MATERIAL_MISSING');
   await median?.finish();signal?.throwIfAborted();
   const result=mapper.finish();if(result.issues.length)fail(result.limited?'MATERIAL_ANALYSIS_LIMIT':result.precision?'MATERIAL_PRECISION':'MATERIAL_INVALID');
   return {commandHash:digest(revisionText(command)),content:{inputs:[dataset],tool:'Observanda table mapping',version:'6',parameters:JSON.stringify(mapping),mapping,numericTransform:{algorithm:'exact-rational-to-binary64',version:2,policy:mapping.numericPolicy??'safe',significantDigits:17,...(operation!=='raw'?{reduction:{algorithm:'exact-rational-reduction',version:1,operation,grouping:'exact-coordinate',projection:'after-reduction'}}:{})},figure:withoutFigureSources(result.figure),denominator,warnings:result.warnings}};
  }catch(error){if(error.message==='precision')fail('MATERIAL_PRECISION');throw error;}
  finally{if(median)await this.cleanPlotWork(jobId,attempt);}
 }
 async commitPlot(command,prepared){
  if(prepared.commandHash!==digest(revisionText(command)))fail('MATERIAL_CHANGED');
  await this.validatePlot(command);const {recordId,title,id,expectedRevision}=command;
  return this.commit({kind:'analysis',recordId,title,id,expectedRevision,content:prepared.content});
 }
 async plot(command,options={}){
  const prepared=await this.preparePlot(command,options),ref=await this.workspace.withLock(()=>this.commitPlot(command,prepared));
  return {ref,figure:prepared.content.figure,warnings:prepared.content.warnings};
 }
 async reuseFigure({recordId,analysis}){
  return this.workspace.withLock(async()=>{
   if(analysis?.kind!=='analysis')fail();const source=await this.read(analysis);if(!source.content.figure)fail();
   const figure=withoutFigureSources(source.content.figure);figure.id=randomUUID();
   const ref=await this.commit({kind:'analysis',recordId,title:source.title,content:{inputs:[analysis],tool:'Observanda retained figure',version:'1',parameters:'Reuse an exact calculated result',figure,denominator:source.content.denominator}});
   return {ref,figure};
  });
 }
 async list(options={}){return this.index.page(options);}
 async overview(recordId,{cursor=null,importCursor=null,limit=20,signal}={}){
  await this.assertOwner(recordId);
  return this.readSnapshot(async store=>{
  const listing=await this.list({recordId,cursor,limit,signal}),heads=listing.items;
  // Share one repeatable read for the dependency review. Opening a database
  // snapshot for each edge makes even modest collections expensive to inspect.
  const assess=()=>withMaterialTraversal(async traversal=>{
  const book=store?null:await this.owner(recordId),snapshot=store?await store.snapshot():null,byId=new Map();
  const owner=store?await store.member(snapshot,recordId):null;if(store&&!owner)fail();
  const recordHeads=new Map(book?.entries.map(r=>[r.id,recordRevision(r)])??[]);
  const current=async ref=>{
   if(ref.kind!=='record'){if(!byId.has(ref.id)){if(byId.size===64)byId.delete(byId.keys().next().value);byId.set(ref.id,await this.current(ref.id));}return byId.get(ref.id)?.revision??null;}
   if(!recordHeads.has(ref.id)){
    if(recordHeads.size===64)recordHeads.delete(recordHeads.keys().next().value);
    if(store){
     const member=await store.member(snapshot,ref.id);recordHeads.set(ref.id,(await materialRecordSummary(store,member))?.revision??null);
    }else{
     try{recordHeads.set(ref.id,recordRevision((await this.owner(ref.id)).entries.find(r=>r.id===ref.id)));}catch(error){if(error.code!=='MATERIAL_INVALID')throw error;recordHeads.set(ref.id,null);}
    }
   }
   return recordHeads.get(ref.id);
  };
  // Inspect only small dependency manifests, never evidence bytes/table rows.
  const statuses=[];
  for(const head of heads.filter(h=>h.recordId===recordId)){
   const changed=[];let changedCount=0;await traversal.reset();
   await traversal.walk(this.references(head),async(ref,enqueue)=>{
    signal?.throwIfAborted();const now=await current(ref);if(now!==ref.revision){changedCount++;if(changed.length<20)changed.push({...ref,current:now});}
    if(ref.kind!=='record')for await(const input of this.index.iterInputs(ref))await enqueue(input);
   });
   let figure=null;
   if(head.figureId){
    if(store){const position=await new RecordMemberCollections(store).position(owner,'figures',head.figureId);if(position>=0)figure=await withRecordDocument(store,owner.id,owner.revision,async document=>(await document.field(['figures',String(position)],{signal})).value);
     else if(!owner.collections&&!owner.cardItems)figure=await withRecordDocument(store,owner.id,owner.revision,async document=>{for await(const item of document.items(['figures'])){signal?.throwIfAborted();if((await document.tree.selected(item.value,['id'])).value===head.figureId)return document.tree.read(item.value);}return null;});}
    else figure=book.entries.find(r=>r.id===recordId)?.figures.find(f=>f.id===head.figureId);
   }
   const file=head.kind==='artifact'?(await this.read(head)).content:null;
   statuses.push({...head,...(file?{file:{name:file.name,size:file.size,sha256:file.sha256,...(file.sourcePath?{sourcePath:file.sourcePath}:{}),...(file.sourcePurpose?{sourcePurpose:file.sourcePurpose}:{})}}:{}),changed,changedCount,figureState:head.figureHash?figure?figureFingerprint(figure)===head.figureHash?'matches':'edited':'not-attached':null});
  }
  return statuses;
  },{signal});
  const statuses=await assess();
  const pending=await this.index.page({recordId,pending:true,cursor:importCursor,limit,signal});
   return {...listing,items:statuses,imports:await Promise.all(pending.items.map(item=>this.uploads.summary(item))),importsNext:pending.next};
  });
 }
 async releaseSources(book,selectedIds,{sourceEtag,recordHead:resolveRecordHead}={}){
  return this.readSnapshot(async store=>{
   const snapshot=sourceEtag&&store?await store.snapshot(sourceEtag):null;
   if(snapshot&&snapshot.metadata.id!==book.id)throw new AppError('WORKSPACE_CHANGED');
   const recordHead=async id=>{
    if(resolveRecordHead)return resolveRecordHead(id);
    if(!snapshot){const record=book.entries.find(e=>e.id===id);return record?recordRevision(record):null;}
    const row=await store.member(snapshot,id);if(!row)return null;
    for await(const value of store.queryDocuments([row],snapshot.metadata,{revisions:true,search:false})){
     return value.revision??recordRevision(await store.record(id,row.revision));
    }
    throw new AppError('CATALOGUE_DAMAGED');
   };
   const sources=[],warnings=[],materials=this;
   async function* heads(){
    if(await materials.workspace.storageKind()!=='catalogue'){yield* materials.headEntries();return;}
    for(const recordId of selectedIds){let cursor=null;do{const page=await materials.list({recordId,kind:'analysis',cursor});yield* page.items;cursor=page.next;}while(cursor);}
   }
   return withMaterialTraversal(async traversal=>{
   const reviewInputs=async(doc,recordId,figureId)=>{
    let changed=false;await traversal.reset();
    await traversal.walk(this.references(doc.content),async(input,enqueue)=>{
     const current=input.kind==='record'?await recordHead(input.id):(await this.current(input.id))?.revision;
     if(current!==input.revision)changed=true;
     if(input.kind!=='record')for await(const nested of this.index.iterInputs(input))await enqueue(nested);
    });
    if(changed)warnings.push({recordId,figureId,reason:'inputs'});
   };
   for(const record of book.entries.filter(r=>selectedIds.includes(r.id)))for(const {figure,ref} of figureSourceEntries(record.figures)){
    const doc=await this.read(ref);if(!doc.content.figure)fail('ANALYSIS_INVALID');
    sources.push({recordId:record.id,figureId:figure.id,label:figure.title,analysis:ref});
    if(!sameFigureCalculation(figure,doc.content.figure))warnings.push({recordId:record.id,figureId:figure.id,reason:'edited'});
    await reviewInputs(doc,record.id,figure.id);
   }
   for await(const head of heads()){
    if(head.kind!=='analysis'||!head.figureId||!selectedIds.includes(head.recordId))continue;
    const record=book.entries.find(e=>e.id===head.recordId),figure=record?.figures.find(f=>f.id===head.figureId);if(!figure||figure.source)continue;
    let reference={kind:head.kind,id:head.id,revision:head.revision},doc;
    for(;;){doc=await this.read(reference);if(doc.content.figure&&figureFingerprint(doc.content.figure)===figureFingerprint(figure))break;
     if(!doc.previous){doc=null;break;}reference={...reference,revision:doc.previous};
    }
    if(!doc){warnings.push({recordId:record.id,figureId:figure.id,reason:'edited'});continue;}
    sources.push({recordId:record.id,figureId:figure.id,label:figure.title||doc.title,analysis:reference});
    await reviewInputs(doc,record.id,figure.id);
   }
   for(const record of book.entries.filter(r=>selectedIds.includes(r.id))){
    for(const result of record.results?.statements??[])if(result.source){
     const reference=materialReference(result.source),doc=await this.read(reference);sources.push({recordId:record.id,resultId:result.id,label:result.title,analysis:reference});
     if(result.kind==='figure'&&doc.content.figure){const figure=record.figures.flatMap(f=>[f,...(f.kind==='panels'?figurePlots(f):[])]).find(f=>f.id===result.figureId);if(figure&&!sameFigureCalculation(figure,doc.content.figure))warnings.push({recordId:record.id,figureId:figure.id,reason:'edited'});}
    }
    for(const assessment of currentAttemptItems(record.attempt?.assessments??[]))for(const source of assessment.references.filter(r=>r.kind==='analysis')){
     const reference=materialReference(source);await this.read(reference);
     const criterion=record.attempt.preparations.find(p=>p.id===assessment.preparationId)?.criteria.find(c=>c.id===assessment.criterionId);
     sources.push({recordId:record.id,assessmentId:assessment.id,label:criterion?.label??source.label,analysis:reference});
    }
   }
   return {sources,warnings:[...new Map(warnings.map(w=>[w.recordId+':'+w.figureId+':'+w.reason,w])).values()]};
   });
  });
 }
 async verify(){
  return this.workspace.withLock(()=>this.verifySnapshot());
 }
 // The caller pins the catalogue snapshot (or holds the writer lock). A
 // detached restore audit must never create derived indexes or activate itself.
 async verifySnapshot({readOnly=false}={}){
  try{return await withMaterialTraversal(async traversal=>{
   const originals=new Set();let bytes=0;
   const check=ref=>traversal.walk([ref],async(ref,enqueue)=>{
    if(ref.kind==='record'){await this.checkReference(ref);return;}
    const doc=await this.read(ref);
    if(revisionText(await this.index.inputSet(ref))!==revisionText(this.referenceSet(doc.content)))fail('CATALOGUE_DAMAGED');
    if(doc.previous)await enqueue({...ref,revision:doc.previous});
    for await(const input of this.references(doc.content))await enqueue(input);
    for await(const output of this.references(doc.content,'outputs'))await enqueue(output);
    if(doc.content.acquisition)await enqueue(doc.content.acquisition);
    if(ref.kind==='dataset'){
     for(const column of await this.datasetColumns(doc))for(const r of schemaReferences(column))await enqueue(r);
     if(doc.content.aggregationMembersIndex&&!doc.content.aggregation)fail('MATERIAL_MISSING');
     const aggregationContext=doc.content.aggregationMembersIndex?await aggregationMemberContext(this,doc):null;let memberOffset=0;
     for await(const row of this.iterateDataset(ref)){
      if(aggregationContext){
       if(row.aggregationMembers?.offset!==memberOffset)fail('MATERIAL_MISSING');
       for await(const member of aggregationMemberRows(this,aggregationContext,row)){void member;}
       memberOffset+=row.aggregationMembers.count;
      }else if(row.aggregationMembers)fail('MATERIAL_MISSING');
     }
     if(aggregationContext&&memberOffset!==aggregationContext.index.count)fail('MATERIAL_MISSING');
    }
    if(doc.content.measurement)await this.measurements.validate(doc.content.measurement);
    if(doc.content.method){if(!validAnalysisMethod(doc.content.method))fail('CATALOGUE_DAMAGED');for(const r of analysisMethodReferences(doc.content.method))await enqueue(r);}
    if(doc.content.comparison){const c=doc.content;await this.comparisons.verify({recordId:doc.recordId,title:doc.title,tool:c.tool,version:c.version,method:c.method,comparison:c.comparison},c.summary);}
    if(ref.kind==='artifact'){
     const identity=path.join(this.workspace.root,...artifactRelative(doc).split('/'))+':'+doc.content.size+':'+doc.content.sha256;
     if(!originals.has(identity)){await this.artifact(ref);if(originals.size>=64)originals.delete(originals.values().next().value);originals.add(identity);}
     bytes+=doc.content.size;
    }
   });
   for await(const head of this.headEntries())await check(head);
   for await(const id of this.names('records')){if(!researchId(id))continue;for await(const file of this.names('records/'+id))if(/^[a-f0-9]{64}\.json$/.test(file))await check({kind:'record',id,revision:file.slice(0,-5)});}
   let pendingImports=0,receivedBytes=0;
   for await(const id of this.names('imports')){if(!researchId(id))continue;const session=await this.importState(id);if(session.completed)continue;
    pendingImports++;await this.withUploadChunks(session,async chunks=>{for await(const part of chunks)receivedBytes+=part.receipt.size;});
   }
   await this.drafts.verify(check);await this.intakes.verify(check,{verified:originals});await this.associations.verify(check);await new EvidenceCorrections(this).verify(check);
   if(await this.workspace.storageKind()==='catalogue')await this.index.verify({initialize:!readOnly});
   return {revisions:traversal.size,originalBytes:bytes,pendingImports,receivedBytes};
  });}catch(error){if(error.code==='ENOENT')fail('MATERIAL_MISSING');throw error;}
 }
}
