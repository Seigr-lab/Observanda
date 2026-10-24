import {StatisticalUncertaintyResults} from './statistical-uncertainty-results.js';
import {statisticalUncertaintyMaterial,assertStatisticalUncertaintyFormat} from './statistical-uncertainty-format.js';
import {validStatisticalUncertaintyDescriptor} from './web/measurement-statistical-uncertainty-model.js';
import {pairedStatisticsMaterial,assertPairedStatisticsFormat} from './paired-statistics-format.js';
import {axisPermutationMaterial,assertAxisPermutationFormat} from './axis-permutation-format.js';
import {quantileAggregationMaterial,assertQuantileAggregationFormat} from './quantile-aggregation-format.js';
import {validateAggregationReceipts,resolveAggregationReceipts} from './dataset-aggregation-quantiles.js';
import {tensorValuesMaterial,assertTensorValuesFormat} from './tensor-values-format.js';
import {validClockSynchronizationDescriptor} from './web/measurement-clock-synchronization-model.js';
import {clockSynchronizationMaterial,assertClockSynchronizationFormat} from './clock-synchronization-format.js';
import {domainAlgebraMaterial,assertDomainAlgebraFormat} from './domain-algebra-format.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {measurementScalarPolicies,resolveScalarDefinitions,resolveScalarOperand,scalarDefinitionSequences} from './measurement-scalar-storage.js';
import {measurementScalarMaterial,assertMeasurementScalarFormat} from './measurement-scalar-format.js';
import {CalculatorResults} from './calculator-results.js';
import {validComputation} from './web/measurement-computation.js';
import {approximateCalculatorMaterial,assertApproximateCalculatorFormat} from './approximate-calculator-format.js';
import {calculatorResultMaterial} from './web/calculator-result-model.js';
import {assertCalculatorResultFormat} from './calculator-result-format.js';
import {assertPlotResourcePolicy,plotNumericalMetadata} from './plot-resource-policy.js';
import {intervalUncertaintyMaterial,intervalFormatCheck} from './interval-uncertainty-format.js';
import {clockDerivationMaterial} from './clock-derivation-format.js';
import {nativeDomainMaterial} from './native-domain-format.js';
import {domainValueReference,validateDomainValue} from './measurement-domain-storage.js';
import {prepareRetainedPlot} from './retained-figure-plot.js';
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {nativeNumericalMaterial,nativeClockMaterial} from './numerical-material-format.js';
import {datasetRowPosition,datasetPageInfo} from './dataset-row-position.js';
import {datasetColumns as storedDatasetColumns,storedDatasetCells,preparePagedDataset,projectDatasetRows} from './dataset-storage.js';
import {readDatasetCell,verifyDatasetCell} from './dataset-cell-storage.js';
import {readPagedDataset} from './dataset-paged-reader.js';
import {datasetPlotSelection,verifySelectedPlot} from './dataset-plot-selection.js';
import {assertPlotProjectionUnits,withPlotProvenance,verifyPlotProjection} from './dataset-plot-provenance.js';
import {assertDatasetScalars} from './dataset-selected-columns.js';
import {assertRecordOwnerRevisionVisible} from './record-owner-read-visibility.js';
import {readRecordOwnerMetadata} from './record-owner-audit-metadata.js';
import {artifactRelative,retiredArtifactContent} from './project-artifact-content.js';
import {materialKinds,validMaterialReference,materialReference,materialReferenceKey} from './web/material-reference.js';
import {workspaceReferenceNamespaceMatches} from './research-reference-namespace.js';
import {recordOwnerExternalReference} from './record-owner-provenance.js';
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
import {datasetMapping,DATASET_LIMITS} from './dataset-reader.js';
import {createFigure,figureIssues} from './web/figure-model.js';
import {figurePlots} from './web/figure-composition.js';
import {sameFigureCalculation} from './web/figure-result-links.js';
import {figureSourceEntries,withoutFigureSources} from './web/figure-provenance.js';
import {createFigureMapper} from './web/figure-import-model.js';
import {PagedMedian} from './paged-median.js';
import {withMaterialTraversal} from './material-traversal.js';
import {withScratch,withScratchSession} from './scratch-work.js';
import {MaterialUploadChunks} from './material-upload-chunks.js';
import {withWorkspaceMetadataBatch,metadataBatchIndex} from './metadata-batch.js';
import {MaterialIndex} from './material-index.js';
import {materialHeadVisible,materialBatch,materialReferenceVisible,materialReturnedHead,settleMaterialReturnHead} from './material-visibility.js';
import {MaterialSequence} from './material-sequence.js';
import {MaterialDrafts} from './material-drafts.js';
import {MaterialChoices} from './material-choices.js';
import {EvidenceIntake} from './evidence-intake.js';
import {EvidenceAssociationBatches} from './evidence-association-batches.js';
import {EvidenceCorrections} from './evidence-corrections.js';
import {fileFingerprint} from './web/evidence-fingerprint.js';
import {REPRESENTATIONS,validQuantity,validTime,schemaReferences,validColumnDomain} from './web/measurement-model.js';
import {Measurements} from './measurements.js';
import {AnalysisComparisons} from './analysis-comparisons.js';
import {currentAttemptItems} from './web/attempt-model.js';
import {validAnalysisMethod,analysisMethodReferences} from './web/analysis-model.js';
import {validNativeMapping} from './native-mapping.js';
import {exactRational} from './web/measurement-model.js';
import {compareRationalText,sumRationalText} from './web/measurement-reduction.js';
import {defaultColumn} from './web/dataset-schema.js';
import {DatasetCalculations,verifyRetainedCalculation} from './dataset-calculations.js';
import {DatasetAggregation,clearAggregationWork,verifyAggregationPolicy} from './dataset-aggregation.js';
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
  c&&(c.statisticalUncertainty===undefined||validStatisticalUncertaintyDescriptor(c.statisticalUncertainty))&&(c.synchronization===undefined||validClockSynchronizationDescriptor(c.synchronization))&&(c.computation===undefined||validComputation(c.computation))&&required(c.name,200)&&REPRESENTATIONS.includes(c.representation)&&validColumnDomain(c)&&
  Number.isInteger(c.radix)&&c.radix>=2&&c.radix<=36&&text(c.unit,100)&&Array.isArray(c.missing)&&c.missing.length<=30&&
  c.missing.every(m=>m&&text(m.value,100)&&required(m.meaning,200))&&
  (c.resourcePolicy===undefined||['decimal','integer','radix','radix-fraction','rational'].includes(c.representation)&&validDatasetResourcePolicy(c.resourcePolicy))&&validTime(c.time)&&(c.quantity===undefined||validQuantity(c.quantity,c.unit)));
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
 async json(file,{missing=false}={}){const raw=await readRecordOwnerMetadata(this.workspace,this.relative(file),16*1024*1024);if(raw===null){if(missing)return null;fail('MATERIAL_MISSING');}return JSON.parse(raw);}
 async put(file,data){if(file===this.metadataFile('objects/'+data.id+'/head.json'))await settleMaterialReturnHead(this.workspace,data.id);await this.workspace.writeMetadata(this.relative(file),JSON.stringify(data)+'\n');}
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
   if(write){const {assertRecordOwnerWritable}=await import('./record-owner-transfer-state.js');await assertRecordOwnerWritable(store,recordId);}
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
  const doc=await this.readStored(ref);
  if(ref.kind==='record'&&await this.workspace.storageKind()==='catalogue')await this.workspace.catalogue(store=>assertRecordOwnerRevisionVisible(store,ref.id,ref.revision));
  if(ref.kind!=='record'){const head=await this.current(ref.id,{includeStaged:true});if(!await materialReferenceVisible(this.workspace,ref,head))fail('MATERIAL_INCOMPLETE');}
  return doc;
 }
 // Internal integrity and ownership checks may inspect an unpublished revision.
 // Public references always pass through read() and its atomic visibility gate.
 async readStored(ref){
  if(!materialRef(ref))fail();
  await this.assertReferenceWorkspace(ref);
  if(ref.kind==='record'&&await this.workspace.storageKind()==='catalogue')return new RetainedRecordDocuments(this.workspace).value(ref,{raw:true});
  const doc=await this.json(this.metadataFile((ref.kind==='record'?'records/':'objects/')+ref.id+'/'+ref.revision+'.json'));
  if((ref.kind==='record'?recordRevision(doc):digest(revisionText(doc)))!==ref.revision)fail('MATERIAL_MISSING');
  if(ref.kind!=='record'&&(doc.format!==1||doc.kind!==ref.kind||doc.id!==ref.id))fail('MATERIAL_MISSING');
  if(calculatorResultMaterial(doc))await assertCalculatorResultFormat(this.workspace,doc);
  if(approximateCalculatorMaterial(doc))await assertApproximateCalculatorFormat(this.workspace);
  if(statisticalUncertaintyMaterial(doc))await assertStatisticalUncertaintyFormat(this.workspace);
  if(pairedStatisticsMaterial(doc))await assertPairedStatisticsFormat(this.workspace);
  if(axisPermutationMaterial(doc))await assertAxisPermutationFormat(this.workspace);
  if(quantileAggregationMaterial(doc))await assertQuantileAggregationFormat(this.workspace);
  if(tensorValuesMaterial(doc))await assertTensorValuesFormat(this.workspace);
  if(clockSynchronizationMaterial(doc))await assertClockSynchronizationFormat(this.workspace);
  return doc;
 }
 async assertReferenceWorkspace(ref){
  if(!materialRef(ref)||!await workspaceReferenceNamespaceMatches(this.workspace,ref))fail();
 }
 async externalReference(ref){if(!materialRef(ref))fail();return recordOwnerExternalReference(this.workspace,ref);}
 async referenceAddress(ref){return await this.externalReference(ref)??materialReference(ref);}
 async checkReference(ref,{signal}={}){
  await this.assertReferenceWorkspace(ref);
  if(ref?.kind==='record'&&await this.workspace.storageKind()==='catalogue')return new RetainedRecordDocuments(this.workspace).check(ref,{signal});
  await this.read(ref);
 }
 async *headEntries({includeStaged=false}={}){
  for await(const id of this.names('objects')){if(!researchId(id))continue;
   const head=await this.current(id,{includeStaged});if(head)yield head;
  }
 }
 async heads(){return Array.fromAsync(this.headEntries());}
 async current(id,{includeStaged=false}={}){if(!researchId(id))fail();const raw=await this.json(this.metadataFile('objects/'+id+'/head.json'),{missing:true}),head=await materialReturnedHead(this.workspace,id,raw,{includeStaged});if(head!==null&&(!materialRef(head)||head.id!==id))fail('MATERIAL_MISSING');return head&&(includeStaged||await materialHeadVisible(this.workspace,head))?head:null;}
 // Call under the workspace lock. Revision and head share the metadata transaction.
 async commit({kind,recordId,title,content,id=randomUUID(),expectedRevision=null},{stagedBatch=null,createdAt=new Date().toISOString()}={}){
  if(!kinds.includes(kind)||!researchId(id)||!required(title,300)||typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt)))fail();
  await this.assertOwner(recordId,{write:true});await this.index.ensureLocked();await settleMaterialReturnHead(this.workspace,id);
  const headFile=this.metadataFile('objects/'+id+'/head.json'),previous=await this.json(headFile,{missing:true});
  if((previous?.revision??null)!==expectedRevision||previous&&(previous.kind!==kind||previous.recordId!==recordId)||previous&&!await materialHeadVisible(this.workspace,previous))fail('MATERIAL_CHANGED');
  if(stagedBatch!==null){const batch=await materialBatch(this.workspace,stagedBatch);if(previous||kind!=='artifact'||batch.command.recordId!==recordId||batch.state!=='processing')fail('MATERIAL_CHANGED');}
  const doc={format:1,kind,id,recordId,title,createdAt,previous:previous?.revision??null,content};
  if(Buffer.byteLength(JSON.stringify(doc))+1>16*1024*1024)fail('LIMIT');
  const ref=refOf(doc),file=this.metadataFile('objects/'+id+'/'+ref.revision+'.json');
  await this.put(file,doc);
  const head={...ref,recordId,title,createdAt:doc.createdAt,...this.referenceSet(content),figureHash:content.figure?figureFingerprint(content.figure):null,figureId:content.figure?.id??null,...(stagedBatch||previous?.stagedBatch?{stagedBatch:stagedBatch??previous.stagedBatch}:{}),...(previous?.ownerTransfer?{ownerTransfer:previous.ownerTransfer}:{})};
  await this.put(headFile,head);await this.index.changed(head,doc,{stagedBatch});
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
 async importState(id,{raw=false}={}){
  if(!researchId(id))fail();let session=this.uploads.validate(await this.json(this.metadataFile('imports/'+id+'/session.json')));
  if(!raw&&session.batchId&&!session.completed){const batch=await this.intakes.read(session.batchId);if(batch.state==='completed'&&batch.finalization)session={...session,completed:(await this.intakes.finalization.receipt(batch,session)).ref};}
  return session;
 }
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
 // Build the immutable artifact once; staging and single-file completion share
 // validation and provenance, but publish through different visibility owners.
 async importCommand(session,prepared){
  if(!researchId(prepared.storageId)||prepared.sessionHash!==digest(JSON.stringify({...session,completed:null}))||prepared.size!==session.size)fail('MATERIAL_CHANGED');
  const originalId=prepared.originalId??session.id;if(!researchId(originalId))fail('MATERIAL_CHANGED');
  const file=path.join(await this.directory('originals/'+originalId,{create:false}),prepared.storageId+'.original');await assertRegular(file);
  return {kind:'artifact',id:session.id,recordId:session.recordId,title:session.name,content:{name:session.name,size:prepared.size,sha256:prepared.sha256,storageId:prepared.storageId,...(session.batchId?{originalId,fingerprint:session.fingerprint,intakeId:session.batchId}:{}),...(session.sourcePath?{sourcePath:session.sourcePath}:{}),...(session.sourcePurpose?{sourcePurpose:session.sourcePurpose}:{}),provenance:session.provenance,acquisition:session.acquisition,inputs:session.derivesFrom}};
 }
 // The caller holds the workspace transaction, including the worker lease fence.
 async commitImport(id,prepared,{cleanup=true}={}){
  const session=await this.importState(id);if(session.completed)return session.completed;
  const ref=await this.commit(await this.importCommand(session,prepared));
  session.completed=ref;await this.put(this.metadataFile('imports/'+id+'/session.json'),session);await this.index.finishImport(session);
  if(cleanup)await this.workspace.afterCommit(()=>this.readSnapshot(()=>this.cleanImport(session)).catch(()=>{}));return ref;
 }
 async stageImport(id,prepared,batchId){
  const session=await this.importState(id,{raw:true});if(session.completed||session.batchId!==batchId)fail('MATERIAL_CHANGED');
  return this.commit(await this.importCommand(session,prepared),{stagedBatch:batchId});
 }
 async cleanAttempts(id,{only=null}={}){
  const session=await this.importState(id),folder=await this.directory('originals/'+id);
  const manifest=session.completed?await this.read(session.completed):null;
  const retained=new Set(manifest?[manifest.content.storageId?manifest.content.storageId+'.original':'original']:[]);
  if(session.batchId){const prepared=await this.intakes.json(this.intakes.file(session.batchId,'prepared/'+id+'.json'));if(prepared){await this.intakes.preparedContent(session,prepared);if(prepared.originalId===id)retained.add(prepared.storageId+'.original');}}
  for(const name of await readdir(folder)){
   if(retained.has(name)||only&&name!==only+'.original'||!/^([a-f0-9-]{36}\.original|\.stream-[a-f0-9-]{36})$/.test(name))continue;
   try{const file=path.join(folder,name);if(await assertRegular(file,{missing:true}))await unlink(file);}catch{/* An interrupted attempt may still hold its file; later cleanup is safe. */}
  }
 }
 async cleanImport(session){
  session=await this.importState(session.id);if(!session.completed)return;
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
  if(command.uncertainty)return new StatisticalUncertaintyResults(this).preview(command,{signal});
  if(command.calculatorResult)return new CalculatorResults(this).preview(command,{signal});
  if(command.aggregation)return new DatasetAggregation(this).preview(command,{signal});
  if(command.calculation)return new DatasetCalculations(this).preview(command,{signal});
  await this.validateDataset(command);const source=await this.artifact(command.artifact,{signal}),rows=[],columns=[],columnOffset=command.columnOffset??0;let columnCount=0;
  if(!Number.isSafeInteger(columnOffset)||columnOffset<0)fail();
  for await(const item of readPagedDataset(source.content.read(0,source.content.size-1,{signal}),command.sourceMapping,{signal,size:source.content.size})){
   if(item.columnCount!==undefined){columnCount=item.columnCount;if(columnOffset>=columnCount)fail();let i=0;for await(const col of item.columns()){if(i>=columnOffset&&i<columnOffset+16)columns.push(col.name);if(++i>=columnOffset+16)break;}}
   else {const cells=[],truncated=[],valueKinds=[];let i=0;for await(const cell of item.cells()){if(i>=columnOffset&&i<columnOffset+16){let value='';for await(const part of cell.read()){value+=part.slice(0,4097-value.length);if(value.length>4096)break;}cells.push(value.slice(0,4096));truncated.push(value.length>4096);valueKinds.push(cell.kind);}if(++i>=columnOffset+16)break;}rows.push({line:item.line,order:item.order,locator:item.locator,cells,truncated,valueKinds});}
   if(rows.length===5)break;
  }
  return {columns,columnOffset,columnCount,nextColumn:columnOffset+columns.length<columnCount?columnOffset+columns.length:null,rows};
 }
 async validateDataset(command){
  if(command.uncertainty)return new StatisticalUncertaintyResults(this).validate(command);
  if(command.calculatorResult)return new CalculatorResults(this).validate(command);
  if(command.aggregation)return new DatasetAggregation(this).validate(command);
  if(command.calculation)return new DatasetCalculations(this).validate(command);
  const {artifact,recordId,title,id,expectedRevision}=command;
  if(!materialRef(artifact)||!command.baseDataset&&artifact.kind!=='artifact'||!required(title,300)||id!==undefined&&!researchId(id)||expectedRevision!==undefined&&expectedRevision!==null&&!revisionId(expectedRevision))fail();
  if(!command.baseDataset)datasetMapping(command.sourceMapping);
  if(command.nativeMapping!==undefined){if(!validNativeMapping(command.nativeMapping))fail();await this.read(command.nativeMapping.artifact);}
  if(command.baseDataset){
   if(command.baseDataset.kind!=='dataset'||!materialRef(command.baseDataset)||command.baseDataset.id!==id||command.baseDataset.revision!==expectedRevision)fail();
   const base=await this.read(command.baseDataset);if(base.content.calculatorResult)fail('CALCULATOR_RESULT_INVALID');if(base.content.uncertainty)fail('STATISTICAL_UNCERTAINTY_INVALID');
   if(revisionText(base.content.inputs[0])!==revisionText(artifact)||base.recordId!==recordId)fail();
   if(command.sourceMapping){
    let mapping=base.content.calculation||base.content.aggregation||base.content.datasetFormat===3&&command.sourceMapping.fieldsInSchema?command.sourceMapping:datasetMapping(command.sourceMapping);
    if(base.content.datasetFormat===3&&mapping.fields){const {fields,...rest}=mapping;mapping={...rest,fieldsInSchema:true};if(Array.isArray(fields)){let index=0;for await(const column of this.iterateDatasetColumns(base)){if(revisionText(column.sourceField)!==revisionText(fields[index++]))fail();}if(index!==fields.length)fail();}}
    if(revisionText(mapping)!==revisionText(base.content.sourceMapping??{format:'delimited',delimiter:base.content.delimiter,header:true}))fail();
   }
  }
  await this.assertOwner(recordId);await this.read(artifact);
  if(id){const current=await this.current(id);if((current?.revision??null)!==(expectedRevision??null)||current&&(current.kind!=='dataset'||current.recordId!==recordId))fail('MATERIAL_CHANGED');}
  if(command.columns!==undefined&&(!Array.isArray(command.columns)||!validColumns(command.columns,command.columns.length)))fail();
  if(command.columnChanges!==undefined&&(!command.baseDataset||command.columns!==undefined||!Array.isArray(command.columnChanges)||new Set(command.columnChanges.map(c=>c?.index)).size!==command.columnChanges.length||command.columnChanges.some(c=>!c||!Number.isSafeInteger(c.index)||c.index<0||!validColumns([c.column],1))))fail();
  if(command.exclusions!==undefined&&(!command.exclusions||typeof command.exclusions!=='object'||Array.isArray(command.exclusions)||Object.values(command.exclusions).some(v=>!(command.baseDataset&&v===null)&&!required(v,1000))))fail();
  for(const column of [...command.columns??[],...(command.columnChanges??[]).map(c=>c.column)])for(const ref of schemaReferences(column))await this.checkReference(ref);
 }
 async prepareDataset(command,{signal,progress=async()=>{},writePage,jobId=null}={}){
  if(command.uncertainty)return new StatisticalUncertaintyResults(this).prepare(command,{signal,progress,writePage,jobId});
  if(command.calculatorResult)return new CalculatorResults(this).prepare(command,{signal,progress,writePage});
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
 async prepareDatasetRows(command,options={}){return this.workspace.withCatalogueConnections(()=>preparePagedDataset(this,command,{...options,validColumns}));}
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
  if([2,3].includes(doc.content.datasetFormat)){this.sequences.validate(doc.content.pageIndex);this.sequences.validate(doc.content.schemaIndex);if(doc.content.pageIndex.kind!=='pages'||doc.content.schemaIndex.kind!==(doc.content.scalarPolicies===1?'columns-policy':'columns')||doc.content.schemaIndex.count<1)fail('MATERIAL_MISSING');return doc.content.pageIndex.count;}
  if(doc.content.datasetFormat!==undefined||!Array.isArray(doc.content.pages)||!Array.isArray(doc.content.columns))fail('MATERIAL_MISSING');return doc.content.pages.length;
 }
 async schemaPage(ref,{offset=0,limit=16}={}){if(ref?.kind!=='dataset')fail();return this.retainedSchemaPage(await this.read(ref),{offset,limit});}
 async retainedSchemaPage(doc,{offset=0,limit=16}={}){
  this.datasetPageCount(doc);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>256)fail();
  const page=[2,3].includes(doc.content.datasetFormat)?await this.sequences.page(doc.content.schemaIndex,{offset,limit}):{items:doc.content.columns.slice(offset,offset+limit),offset,total:doc.content.columns.length,next:offset+limit<doc.content.columns.length?offset+limit:null};
  if(offset>page.total||!validColumns(page.items,page.items.length))fail('MATERIAL_MISSING');if(page.items.some(column=>column.statisticalUncertainty))await assertStatisticalUncertaintyFormat(this.workspace);return page;
 }
 async *iterateDatasetColumns(doc){this.datasetPageCount(doc);for await(const column of storedDatasetColumns(this,doc)){if(!validColumns([column],1))fail('MATERIAL_MISSING');yield column;}}
 async datasetColumn(doc,index){if(!Number.isSafeInteger(index)||index<0)fail();const page=await this.retainedSchemaPage(doc,{offset:index,limit:1});if(page.items.length!==1)fail();return page.items[0];}
 async datasetColumns(doc){const count=doc.content.schemaIndex?.count??doc.content.columns?.length;if(count>256)fail('MATERIAL_DATASET_LIMIT');const result=[];for await(const column of this.iterateDatasetColumns(doc))result.push(column);return result;}
 iterateDatasetCells(doc,row){return storedDatasetCells(this,doc,row);}
 readDatasetCell(value,options){return readDatasetCell(this,value,options);}
 async *datasetCellSequences(doc,row){if(doc.content.datasetFormat!==3)return;yield row.cellIndex;for await(const cell of this.iterateDatasetCells(doc,row)){for(const descriptor of [cell.value?.parts,cell.value?.components,cell.value?.original?.parts])if(descriptor)yield descriptor;if(cell.value?.version===3&&cell.value.components)for await(const component of this.sequences.items(cell.value.components))if(component.spelling?.parts)yield component.spelling.parts;}}
 async verifyDatasetRow(doc,row,options){if(doc.content.aggregation?.version===5)await assertPairedStatisticsFormat(this.workspace);if([4,5].includes(doc.content.aggregation?.version)){await assertQuantileAggregationFormat(this.workspace);validateAggregationReceipts(doc.content.aggregation,row);await resolveAggregationReceipts(this,row.aggregation,doc.content.aggregation.resourcePolicy,options);}const checkInterval=options?.checkIntervalFormat??intervalFormatCheck(this.workspace);let count=0,columns=[];for await(const cell of this.iterateDatasetCells(doc,row)){if(doc.content.datasetFormat===3){let column;if(doc.content.domainValues===1||doc.content.scalarPolicies===1){if(count%16===0)columns=(await this.retainedSchemaPage(doc,{offset:count,limit:16})).items;column=columns[count%16];if(!column)fail('MATERIAL_MISSING');}if(doc.content.domainValues===1){if(domainValueReference(cell.value)){if(column?.representation!=='domain')fail('MATERIAL_MISSING');validateDomainValue(this,cell.value,column.domain);if(cell.value.version===2||cell.value.version===3&&cell.value.definition.codec==='observanda.interval')await checkInterval();if([3,4].includes(cell.value.version))await assertMeasurementScalarFormat(this.workspace);if(cell.value.version===4)await assertTensorValuesFormat(this.workspace);}else if(column?.representation==='domain'&&!['absent','null'].includes(cell.kind)&&!column.missing.some(m=>m.value===cell.value))fail('MATERIAL_MISSING');}else if(domainValueReference(cell.value))fail('MATERIAL_MISSING');if(doc.content.scalarPolicies===1&&column.resourcePolicy)await resolveScalarOperand(this,cell,column,options);await verifyDatasetCell(this,cell,options);}else if(typeof cell.value!=='string')fail('MATERIAL_MISSING');count++;}if(count!==(doc.content.schemaIndex?.count??doc.content.columns.length))fail('MATERIAL_MISSING');}
 async datasetPage(ref,page=0,{columnOffset=null,columnLimit=16}={}){
  if(ref?.kind!=='dataset'||!Number.isSafeInteger(page)||page<0)fail();const doc=await this.read(ref);
  if(columnOffset===null)return {...await this.retainedDatasetPage(doc,page),columns:await this.datasetColumns(doc)};
  if(!Number.isSafeInteger(columnOffset)||columnOffset<0||!Number.isSafeInteger(columnLimit)||columnLimit<1||columnLimit>32)fail();
  const schema=await this.retainedSchemaPage(doc,{offset:columnOffset,limit:columnLimit});if(columnOffset>=schema.total)fail();
  return {...await this.retainedDatasetPage(doc,page,{columns:schema.items.map((_,i)=>columnOffset+i)}),columns:schema.items,columnOffset,columnCount:schema.total};
 }
 datasetRowPosition(doc,options){return datasetRowPosition(this,doc,options);}
 async retainedDatasetPage(doc,page,{columns,metadataOnly=false}={}){
  const pages=this.datasetPageCount(doc);if(!Number.isSafeInteger(page)||page<0)fail();
  if(!pages&&page===0&&doc.content.rowCount===0)return {rows:[],page,pages:0,rowCount:0};if(page>=pages)fail();
  const info=[2,3].includes(doc.content.datasetFormat)?await this.sequences.item(doc.content.pageIndex,page):doc.content.pages[page];if(!info)fail();
  if(!revisionId(info.hash)||!Number.isSafeInteger(info.count)||info.count<1||info.count>DATASET_LIMITS.pageRows)fail('MATERIAL_MISSING');
  datasetPageInfo(doc,page,info);
  const rows=await this.json(this.metadataFile('tables/'+info.hash+'.json'));
  if(digest(revisionText(rows))!==info.hash||rows.length!==info.count||doc.content.datasetFormat===3&&doc.content.includedRowCount!==undefined&&rows.filter(row=>!row.excluded).length!==info.included)fail('MATERIAL_MISSING');
  return {...(metadataOnly?{rows}:await projectDatasetRows(this,doc,rows,columns)),page,pages,rowCount:doc.content.rowCount,...(info.includedStart!==undefined?{includedStart:info.includedStart}: {})};
 }
 async *iterateDataset(ref,options={}){
  if(ref?.kind!=='dataset')fail();const doc=await this.read(ref);let count=0;
  let included=0;for(let i=0;i<this.datasetPageCount(doc);i++){const page=await this.retainedDatasetPage(doc,i,options);if(doc.content.datasetFormat===3&&doc.content.includedRowCount!==undefined&&page.includedStart!==included)fail('MATERIAL_MISSING');for(const row of page.rows){count++;if(!row.excluded)included++;yield row;}}
  if(count!==doc.content.rowCount||doc.content.includedRowCount!==undefined&&included!==doc.content.includedRowCount)fail('MATERIAL_MISSING');
 }
 // Bounded convenience reader for callers explicitly requesting a small table.
 async datasetRows(ref,{maxBytes=16*1024*1024}={}){const rows=[];let bytes=0;for await(const row of this.iterateDataset(ref)){bytes+=Buffer.byteLength(JSON.stringify(row));if(bytes>maxBytes)fail('MATERIAL_PLOT_LIMIT');rows.push(row);}return rows;}
 referenceSet(content,slot='inputs'){
  if(!['inputs','outputs'].includes(slot))fail();
  const provenance=slot==='inputs'?(content.method&&content.tool!=='Observanda clock synchronization'?analysisMethodReferences(content.method):content.provenanceInputs??[]):[];
  if(!Array.isArray(provenance)||!provenance.every(materialRef))fail('MATERIAL_MISSING');
  const extra=provenance.length?{provenanceInputs:provenance}:{};if(slot==='inputs'&&content.schemaInputsIndex){this.sequences.validate(content.schemaInputsIndex);if(content.schemaInputsIndex.kind!=='references')fail('MATERIAL_MISSING');extra.schemaInputsIndex=content.schemaInputsIndex;}
  const index=content[slot+'Index'];
  if(index!==undefined){this.sequences.validate(index);if(index.kind!=='references'||content[slot]!==undefined)fail('MATERIAL_MISSING');return {[slot+'Index']:index,...extra};}
  const items=content[slot]??[];if(!Array.isArray(items)||!items.every(materialRef))fail('MATERIAL_MISSING');return {[slot]:items,...extra};
 }
 async *references(content,slot='inputs'){
  const set=this.referenceSet(content,slot),index=set[slot+'Index'];
  yield* set.provenanceInputs??[];
  if(index)for await(const item of this.sequences.items(index)){if(!materialRef(item))fail('MATERIAL_MISSING');yield item;}else yield* set[slot];
  if(set.schemaInputsIndex)for await(const item of this.sequences.items(set.schemaInputsIndex)){if(!materialRef(item))fail('MATERIAL_MISSING');yield item;}
 }
 async readSnapshot(operation){
  if(await this.workspace.storageKind()!=='catalogue')return operation();
  // Build derived discovery state before pinning the repeatable read. A writer
  // opened from inside that read cannot make new index markers visible to it.
  await this.index.ensure();return this.workspace.catalogue(operation);
 }
 async referenceAddresses(ref,items){
  if(!Array.isArray(items)||items.length>32||!items.every(materialRef))fail();
  return this.workspace.catalogue(async()=>{await this.checkReference(ref);return {items:await Promise.all(items.map(item=>this.referenceAddress(item)))};});
 }
 async referencePage(ref,{slot='inputs',offset=0,limit=20}={}){
  return this.readSnapshot(async()=>{
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)fail();
  const doc=await this.read(ref);if(ref.kind==='record')fail();
  const set=this.referenceSet(doc.content,slot),index=set[slot+'Index'];
  const first=index?.count??set[slot].length,total=first+(set.schemaInputsIndex?.count??0),items=[];if(offset>total)fail();
  if(offset<first)items.push(...(index?(await this.sequences.page(index,{offset,limit:Math.min(limit,first-offset)})).items:set[slot].slice(offset,offset+limit)));
  if(set.schemaInputsIndex&&items.length<limit&&offset+items.length<total)items.push(...(await this.sequences.page(set.schemaInputsIndex,{offset:Math.max(0,offset-first),limit:limit-items.length})).items);
  const page={items,offset,total,next:offset+items.length<total?offset+items.length:null};
  return this.describeReferences(page);
  });
 }
 async describeReferences(page){
  const items=[];for(const ref of page.items){const external=await this.externalReference(ref);if(external){items.push({...external,title:external.id,unavailable:true});continue;}const doc=ref.kind==='record'&&await this.workspace.storageKind()==='catalogue'?await new RetainedRecordDocuments(this.workspace).summary(ref):await this.read(ref);items.push({...ref,title:doc.title});}return {...page,items};
 }
 async retainReferences(items,{outputs=false,checkReference=ref=>this.checkReference(ref),write=fn=>fn()}={}){
  if(!Array.isArray(items))fail();
  if(items.length>64)fail('MATERIAL_REFERENCE_LIMIT');
  if(!items.every(materialRef)||outputs&&items.some(r=>r.kind!=='artifact'))fail();
  const builder=this.sequences.builder('references',write),seen=new Set();
  for(const ref of items){await checkReference(ref);const item=materialReference(ref),key=materialReferenceKey(item);if(seen.has(key))fail('MATERIAL_DUPLICATE');seen.add(key);await builder.append(item);}
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
 async analysisLocked(command){return this.commit(await this.prepareAnalysis(command));}
 async prepareAnalysis(command,options={}){
   const {inputs,tool,version,parameters,outputs=[],method,toolSha256,...identity}=command;
   if(!Array.isArray(inputs)||!inputs.length||!required(tool,200)||!required(version,200)||!text(parameters,20000))fail();
   if(method!==undefined&&!validAnalysisMethod(method))fail('ANALYSIS_INVALID');
   if(toolSha256!==undefined&&!revisionId(toolSha256))fail('ANALYSIS_INVALID');
   const refs=[...new Map([...inputs,...(method?analysisMethodReferences(method):[])].map(r=>[materialReferenceKey(r),r])).values()];
   const inputsIndex=await this.retainReferences(refs,options),outputsIndex=await this.retainReferences(outputs,{...options,outputs:true});
   return {...identity,kind:'analysis',content:{inputsIndex,tool,version,parameters,outputsIndex,...(method?{method}:{}),...(toolSha256?{toolSha256}:{})}};
 }
 async validatePlot(command){
  const {recordId,title,id,expectedRevision,dataset,mapping,base}=command;assertPlotResourcePolicy(mapping);
  if(mapping?.numericPolicy!==undefined&&!['safe','approximate'].includes(mapping.numericPolicy))fail();
  if(!required(title,300)||id!==undefined&&!researchId(id)||expectedRevision!==undefined&&expectedRevision!==null&&!revisionId(expectedRevision)||dataset?.kind!=='dataset'||!materialRef(dataset)||!mapping||!Array.isArray(mapping.values)||mapping.values.length>50||mapping.values.some(v=>!v||!Number.isInteger(v.column)||v.error!==null&&!Number.isInteger(v.error)||[...INTERVAL_FIELDS,'count'].some(k=>v[k]!=null&&!Number.isInteger(v[k]))))fail();
  await this.assertOwner(recordId);const doc=await this.read(dataset);
  if(id){const current=await this.current(id);if((current?.revision??null)!==(expectedRevision??null)||current&&(current.kind!=='analysis'||current.recordId!==recordId))fail('MATERIAL_CHANGED');}
  if(base&&(base.kind==='panels'||figureIssues({...base,series:createFigure().series},{draft:true,resourceErrors:true}).length))fail();
  const selection=await datasetPlotSelection(this,doc,mapping),cols=selection.columns,local=selection.mapping;if(!mapping.projection)for(const v of local.values)for(const k of ['error',...INTERVAL_FIELDS])if(v[k]!=null&&cols[v[k]]?.unit!==cols[k[0]==='x'?local.x:v.column]?.unit)fail();
  assertPlotProjectionUnits(local,cols);
  const mapper=createFigureMapper({columns:cols.map((c,index)=>({index,label:c.name,heading:c.name}))},{...local,mode:'replace',decimal:'.'},base??createFigure(),{resourceErrors:true});
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
  // Reuse owner-authenticated handles, while each selected read and retained
  // block flush still opens its own fresh transaction. The scope drains on abort.
  return this.workspace.withCatalogueConnections(async()=>{
  const doc=await this.validatePlot(command),{mapping,dataset}=command,selection=await datasetPlotSelection(this,doc,mapping),columns=selection.columns,operation=mapping.operation??'raw';
  const write=writePage??(fn=>this.workspace.withLock(fn)),prefix=this.plotWork(jobId,attempt);
  void prefix;
  const retainedWrite=operation=>write(async()=>{if(typeof this.workspace.catalogue==='function')await this.workspace.catalogue(async store=>{const {requireRetainedFigures,requireNativeNumericalModels,requireFigureProjectionPolicies}=await import('./catalogue-format.js');await requireRetainedFigures(store.db);if(mapping.projection)await requireNativeNumericalModels(store.db);if(mapping.resourcePolicy)await requireFigureProjectionPolicies(store.db);});return operation();});
  const result=await prepareRetainedPlot(this,doc,command,selection,{write:retainedWrite,signal,progress});
  return {commandHash:digest(revisionText(command)),content:{inputs:[dataset],tool:'Observanda table mapping',version:mapping.resourcePolicy?'10':'9',parameters:JSON.stringify(mapping),mapping,numericTransform:plotNumericalMetadata(mapping),...result}};
  });
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
 async overview(recordId,{cursor=null,importCursor=null,limit=20,signal,dependencyReview}={}){
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
   const reviewed=await dependencyReview?.(head),changed=reviewed?.changed??[];let changedCount=reviewed?.changedCount??0;await traversal.reset();
   if(!reviewed)await traversal.walk(this.references(head),async(ref,enqueue)=>{
    signal?.throwIfAborted();const external=await this.externalReference(ref);if(external){changedCount++;if(changed.length<20)changed.push({...external,current:null});return;}const now=await current(ref);if(now!==ref.revision){changedCount++;if(changed.length<20)changed.push({...ref,current:now});}
    if(ref.kind!=='record')for await(const input of this.index.iterInputs(ref))await enqueue(input);
   });
   let figure=null;
   if(head.figureId){
    if(store){const position=await new RecordMemberCollections(store).position(owner,'figures',head.figureId);if(position>=0)figure=await withRecordDocument(store,owner.id,owner.revision,async document=>(await document.field(['figures',String(position)],{signal})).value);
     else if(!owner.collections&&!owner.cardItems)figure=await withRecordDocument(store,owner.id,owner.revision,async document=>{for await(const item of document.items(['figures'])){signal?.throwIfAborted();if((await document.tree.selected(item.value,['id'])).value===head.figureId)return document.tree.read(item.value);}return null;});}
    else figure=book.entries.find(r=>r.id===recordId)?.figures.find(f=>f.id===head.figureId);
   }
   const file=head.kind==='artifact'?(await this.read(head)).content:null;
   statuses.push({...head,...(file?{file:{name:file.name,size:file.size,sha256:file.sha256,...(file.sourcePath?{sourcePath:file.sourcePath}:{}),...(file.sourcePurpose?{sourcePurpose:file.sourcePurpose}:{})}}:{}),changed,changedCount,...(reviewed??{}),figureState:head.figureHash?figure?figureFingerprint(figure)===head.figureHash?'matches':'edited':'not-attached':null});
  }
  return statuses;
  },{signal});
  const statuses=await assess();
  const pending=await this.index.page({recordId,pending:true,cursor:importCursor,limit,signal});
   return {...listing,items:statuses,imports:await Promise.all(pending.items.map(item=>this.uploads.summary(item))),importsNext:pending.next};
  });
 }
 async releaseSources(book,selectedIds,{sourceEtag,recordHead:resolveRecordHead,signal}={}){
  signal?.throwIfAborted();
  const records=book.entries.filter(record=>selectedIds.includes(record.id)),unbound=records.filter(record=>record.figures.some(figure=>!figure.source));
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
    // Explicit sources are checked below. Discovery only recovers older
    // calculations for a selected top-level figure without its own source.
    if(!unbound.length)return;
    if(await materials.workspace.storageKind()!=='catalogue'){yield* materials.headEntries();return;}
    for(const record of unbound){let cursor=null;do{signal?.throwIfAborted();const page=await materials.list({recordId:record.id,kind:'analysis',cursor,signal});yield* page.items;cursor=page.next;}while(cursor);}
   }
   // Empty scopes need no traversal table. Actual reviews reuse at most two
   // emptied temporary tables, with a fresh encryption key for each review.
   return withScratchSession(async()=>{
   const reviewInputs=(doc,recordId,figureId)=>withMaterialTraversal(async traversal=>{
    let changed=false;
    await traversal.walk(this.references(doc.content),async(input,enqueue)=>{
     if(await this.externalReference(input)){changed=true;return;}
     const current=input.kind==='record'?await recordHead(input.id):(await this.current(input.id))?.revision;
     if(current!==input.revision)changed=true;
     if(input.kind!=='record')for await(const nested of this.index.iterInputs(input))await enqueue(nested);
    });
    if(changed)warnings.push({recordId,figureId,reason:'inputs'});
   },{signal});
   for(const record of records)for(const {figure,ref} of figureSourceEntries(record.figures)){
    signal?.throwIfAborted();const doc=await this.read(ref);if(!doc.content.figure)fail('ANALYSIS_INVALID');
    sources.push({recordId:record.id,figureId:figure.id,label:figure.title,analysis:ref});
    if(!sameFigureCalculation(figure,doc.content.figure))warnings.push({recordId:record.id,figureId:figure.id,reason:'edited'});
    await reviewInputs(doc,record.id,figure.id);
   }
   for await(const head of heads()){
    signal?.throwIfAborted();
    if(head.kind!=='analysis'||!head.figureId||!selectedIds.includes(head.recordId))continue;
    const record=book.entries.find(e=>e.id===head.recordId),figure=record?.figures.find(f=>f.id===head.figureId);if(!figure||figure.source)continue;
    let reference={kind:head.kind,id:head.id,revision:head.revision},doc;
    for(;;){signal?.throwIfAborted();doc=await this.read(reference);if(doc.content.figure&&figureFingerprint(doc.content.figure)===figureFingerprint(figure))break;
     if(!doc.previous){doc=null;break;}reference={...reference,revision:doc.previous};
    }
    if(!doc){warnings.push({recordId:record.id,figureId:figure.id,reason:'edited'});continue;}
    sources.push({recordId:record.id,figureId:figure.id,label:figure.title||doc.title,analysis:reference});
    await reviewInputs(doc,record.id,figure.id);
   }
   for(const record of records){
    signal?.throwIfAborted();
    const preparations=new Map((record.attempt?.preparations??[]).map(preparation=>[preparation.id,preparation]));
    for(const result of record.results?.statements??[])if(result.source){
     signal?.throwIfAborted();const reference=materialReference(result.source),doc=await this.read(reference);sources.push({recordId:record.id,resultId:result.id,label:result.title,analysis:reference});
     if(result.kind==='figure'&&doc.content.figure){const figure=record.figures.flatMap(f=>[f,...(f.kind==='panels'?figurePlots(f):[])]).find(f=>f.id===result.figureId);if(figure&&!sameFigureCalculation(figure,doc.content.figure))warnings.push({recordId:record.id,figureId:figure.id,reason:'edited'});}
    }
    for(const assessment of currentAttemptItems(record.attempt?.assessments??[]))for(const source of assessment.references.filter(r=>r.kind==='analysis')){
     signal?.throwIfAborted();const reference=materialReference(source);await this.read(reference);
     const criterion=preparations.get(assessment.preparationId)?.criteria.find(c=>c.id===assessment.criterionId);
     sources.push({recordId:record.id,assessmentId:assessment.id,label:criterion?.label??source.label,analysis:reference});
    }
   }
   signal?.throwIfAborted();return {sources,warnings:[...new Map(warnings.map(w=>[w.recordId+':'+w.figureId+':'+w.reason,w])).values()]};
   });
  });
 }
 async verify(){
  return this.workspace.withLock(()=>this.verifySnapshot());
 }
 // The caller pins the catalogue snapshot (or holds the writer lock). A
 // detached restore audit must never create derived indexes or activate itself.
 async verifySnapshot({readOnly=false,signal}={}){
  try{return await withScratch(references=>withMaterialTraversal(async traversal=>{
   const originals=new Set();let bytes=0,externalReferences=0;
   const check=ref=>traversal.walk([ref],async(ref,enqueue)=>{
    const external=await this.externalReference(ref);if(external){if(await references.add('external:'+materialReferenceKey(external)))externalReferences++;return;}
    if(ref.kind==='record'){
     if(await this.workspace.storageKind()==='catalogue'){
      const retained=new RetainedRecordDocuments(this.workspace);
      if(await references.has('history:'+materialReferenceKey(ref)))await retained.open(ref,async(document,row)=>{const encoded=await document.encoding();if(encoded.contentRevision!==ref.revision||row.revision&&encoded.revision!==row.revision)fail('MATERIAL_MISSING');},{history:true,raw:true,legacy:()=>{}});
      else await retained.check(ref,{raw:true});
     }else await this.checkReference(ref);return;
    }
    const doc=await this.read(ref);
    if(approximateCalculatorMaterial(doc))await assertApproximateCalculatorFormat(this.workspace);
  if(statisticalUncertaintyMaterial(doc))await assertStatisticalUncertaintyFormat(this.workspace);
  if(pairedStatisticsMaterial(doc))await assertPairedStatisticsFormat(this.workspace);
  if(axisPermutationMaterial(doc))await assertAxisPermutationFormat(this.workspace);
  if(quantileAggregationMaterial(doc))await assertQuantileAggregationFormat(this.workspace);
  if(tensorValuesMaterial(doc))await assertTensorValuesFormat(this.workspace);
  if(clockSynchronizationMaterial(doc))await assertClockSynchronizationFormat(this.workspace);
    if(calculatorResultMaterial(doc)){await assertCalculatorResultFormat(this.workspace,doc);await new CalculatorResults(this).verify(doc);}
    const checkIntervalFormat=intervalFormatCheck(this.workspace);if(intervalUncertaintyMaterial(doc,{opaqueCompatible:true}))await checkIntervalFormat();
    const checkNumericalFormat=async()=>{if(await this.workspace.storageKind()==='catalogue')await this.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresNativeNumericalModels}=await import('./catalogue-format.js');if(!catalogueRequiresNativeNumericalModels(await catalogueFormat(store.db)))fail('CATALOGUE_DAMAGED');});};
    if(nativeNumericalMaterial(doc))await checkNumericalFormat();
    const checkClockFormat=async()=>{if(await this.workspace.storageKind()==='catalogue')await this.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresNativeClockModels}=await import('./catalogue-format.js');if(!catalogueRequiresNativeClockModels(await catalogueFormat(store.db)))fail('CATALOGUE_DAMAGED');});};
    if(nativeClockMaterial(doc))await checkClockFormat();
    if(clockDerivationMaterial(doc)&&await this.workspace.storageKind()==='catalogue')await this.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresClockDerivations}=await import('./catalogue-format.js');if(!catalogueRequiresClockDerivations(await catalogueFormat(store.db)))fail('CATALOGUE_DAMAGED');});
    const checkDomainFormat=async()=>{if(await this.workspace.storageKind()==='catalogue')await this.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresNativeDomainValues}=await import('./catalogue-format.js');if(!catalogueRequiresNativeDomainValues(await catalogueFormat(store.db)))fail('CATALOGUE_DAMAGED');});};
    if(nativeDomainMaterial(doc))await checkDomainFormat();
    if(revisionText(await this.index.inputSet(ref))!==revisionText(this.referenceSet(doc.content)))fail('CATALOGUE_DAMAGED');
    if(doc.previous)await enqueue({...ref,revision:doc.previous});
    if(doc.content.graphVersion>=6&&doc.content.tool==='Observanda calculation graph'||[9,10,11,12,13,14].includes(doc.content.calculation?.version))await this.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresWindowCalculations}=await import('./catalogue-format.js');if(!catalogueRequiresWindowCalculations(await catalogueFormat(store.db)))fail('CATALOGUE_DAMAGED');});
    if(doc.content.graphVersion>=5&&doc.content.tool==='Observanda calculation graph'||[8,9,10,11,12,13,14].includes(doc.content.calculation?.version))await this.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresDatasetResourcePolicies}=await import('./catalogue-format.js');if(!catalogueRequiresDatasetResourcePolicies(await catalogueFormat(store.db)))fail('CATALOGUE_DAMAGED');});
    if(doc.content.tool==='Observanda calculation graph'||[4,5,6,7,8,9,10,11,12,13,14].includes(doc.content.calculation?.version))await this.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresReferencedCalculations}=await import('./catalogue-format.js');if(!catalogueRequiresReferencedCalculations(await catalogueFormat(store.db)))fail('CATALOGUE_DAMAGED');});
    if(doc.content.uncertainty||['Observanda uncertainty definition','Observanda statistical uncertainty'].includes(doc.content.tool))await new StatisticalUncertaintyResults(this).verify(doc,{signal});
    if(doc.content.tool==='Observanda calculation graph'){const {CalculationGraphs}=await import('./calculation-graphs.js');await new CalculationGraphs(this).verify(doc);}
    const comparison=[2,3].includes(doc.content.comparison?.version);
    if(comparison){
     if(doc.kind!=='analysis')fail('CATALOGUE_DAMAGED');
     const retained=await this.comparisons.verifyIntegrity(doc);
     for(const input of retained.references){
      if(await workspaceReferenceNamespaceMatches(this.workspace,input)){
       if(input.kind==='record')await references.add('history:'+materialReferenceKey(input));await enqueue(input);
      }else if(await references.add('external:'+materialReferenceKey(input)))externalReferences++;
     }
    }else for await(const input of this.references(doc.content))await enqueue(input);
    for await(const output of this.references(doc.content,'outputs'))await enqueue(output);
    if(doc.content.acquisition)await enqueue(doc.content.acquisition);
    if(domainAlgebraMaterial(doc))await assertDomainAlgebraFormat(this.workspace);
    if(measurementScalarMaterial(doc))await assertMeasurementScalarFormat(this.workspace);
    if(ref.kind==='dataset'){
     await verifyRetainedCalculation(this,doc);
     if(doc.content.datasetFormat===3)await this.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresPagedResearchTables}=await import('./catalogue-format.js');if(!catalogueRequiresPagedResearchTables(await catalogueFormat(store.db)))fail('CATALOGUE_DAMAGED');});
     let checkedUnitFormat=false,checkedClockFormat=false,hasDomains=false,hasTensors=false;for await(const column of this.iterateDatasetColumns(doc)){if(!validColumns([column],1))fail('MATERIAL_MISSING');if(column.statisticalUncertainty){if(doc.content.statisticalUncertainties!==1)fail('MATERIAL_MISSING');await assertStatisticalUncertaintyFormat(this.workspace);}if(column.synchronization&&doc.content.clockSynchronization!==1)fail('MATERIAL_MISSING');if(column.computation&&doc.content.approximateComputations!==1)fail('MATERIAL_MISSING');if(measurementScalarPolicies(column)){if(doc.content.scalarPolicies!==1)fail('MATERIAL_MISSING');await assertMeasurementScalarFormat(this.workspace);await resolveScalarDefinitions(this,column,{signal});}if(column.domain?.version===3){hasTensors=true;if(doc.content.tensorValues!==1)fail('MATERIAL_MISSING');await assertTensorValuesFormat(this.workspace);}if(column.representation==='domain'&&!hasDomains){await checkDomainFormat();hasDomains=true;}if(column.quantity?.unitDefinition!==undefined){if(!validQuantity(column.quantity,column.unit))fail('MATERIAL_MISSING');if(!checkedUnitFormat){await checkNumericalFormat();checkedUnitFormat=true;}}if(column.time?.clock?.definition!==undefined){if(!validTime(column.time))fail('MATERIAL_MISSING');if(!checkedClockFormat){await checkClockFormat();checkedClockFormat=true;}}if(column.quantity?.uncertainty!==undefined)await checkIntervalFormat();for(const r of schemaReferences(column))await enqueue(r);}
     if(hasTensors!==(doc.content.tensorValues===1)||doc.content.tensorValues!==undefined&&doc.content.tensorValues!==1)fail('MATERIAL_MISSING');
     if(hasDomains!==(doc.content.domainValues===1)||doc.content.domainValues!==undefined&&doc.content.domainValues!==1)fail('MATERIAL_MISSING');
     if(doc.content.aggregationMembersIndex&&!doc.content.aggregation)fail('MATERIAL_MISSING');
     const aggregationContext=doc.content.aggregationMembersIndex?await aggregationMemberContext(this,doc):null;let memberOffset=0;
     for await(const row of this.iterateDataset(ref,{metadataOnly:true})){
      await this.verifyDatasetRow(doc,row,{checkIntervalFormat});
      if(aggregationContext){
       if(row.aggregationMembers?.offset!==memberOffset)fail('MATERIAL_MISSING');
       for await(const member of aggregationMemberRows(this,aggregationContext,row,{signal})){void member;}
       memberOffset+=row.aggregationMembers.count;
      }else if(row.aggregationMembers)fail('MATERIAL_MISSING');
     }
     if(aggregationContext&&memberOffset!==aggregationContext.index.count)fail('MATERIAL_MISSING');
     await verifyAggregationPolicy(this,doc,{signal});
    }
    if(doc.content.figure?.kind==='retained'){await this.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresRetainedFigures}=await import('./catalogue-format.js');if(!catalogueRequiresRetainedFigures(await catalogueFormat(store.db)))fail('CATALOGUE_DAMAGED');});await (await new RetainedFigureDocuments(this.workspace,{readOnly:true}).open(doc.content.figure)).verify();}
    await verifySelectedPlot(this,doc);await verifyPlotProjection(this,doc);
    if(doc.content.tool==='Observanda clock synchronization'){const {verifyClockSynchronizationInputs}=await import('./clock-synchronization-requests.js');await verifyClockSynchronizationInputs(this,doc.content,{signal});}
    if(doc.content.measurement)await this.measurements.validate(doc.content.measurement,{signal});
    if(doc.content.method&&doc.content.tool!=='Observanda clock synchronization'&&!comparison){if(!validAnalysisMethod(doc.content.method))fail('CATALOGUE_DAMAGED');for(const r of analysisMethodReferences(doc.content.method))await enqueue(r);}
    if(doc.content.comparison&&!comparison){const c=doc.content;await this.comparisons.verify({recordId:doc.recordId,title:doc.title,tool:c.tool,version:c.version,method:c.method,comparison:c.comparison},c.summary);}
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
   const {verifyFigurePresentationReceipts}=await import('./retained-figure-presentation.js');await verifyFigurePresentationReceipts(this);
   await this.drafts.verify(check);await this.intakes.verify(check,{verified:originals});
   const {verifyLocalIntakeFinalizations}=await import('./intake/finalization.js');await verifyLocalIntakeFinalizations(this.workspace,check);await this.associations.verify(check);await new EvidenceCorrections(this).verify(check);
   if(await this.workspace.storageKind()==='catalogue')await this.index.verify({initialize:!readOnly});
   return {revisions:traversal.size,originalBytes:bytes,pendingImports,receivedBytes,...(externalReferences?{externalReferences}:{})};
  }));}catch(error){if(error.code==='ENOENT')fail('MATERIAL_MISSING');throw error;}
 }
}
