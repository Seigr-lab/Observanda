// Selected evidence crosses owners as immutable originals and receipt-bound
// heads. Each metadata group commits independently; publication is one segment.
import path from 'node:path';
import {adaptiveReadMap} from './adaptive-reads.js';
import {retainRecordOwnerResource,recordOwnerMetadataDependencies,journalRecordOwnerMutation} from './record-owner-resources.js';
import {lstat} from 'node:fs/promises';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {privateDirectory} from './storage.js';
import {ResearchMaterials} from './research-materials.js';
import {ResearchTransfer} from './collaboration/research-transfer.js';
import {FileContent} from './file-content.js';
import {withMaterialTraversal} from './material-traversal.js';
import {withScratch} from './scratch-work.js';
import {withRecordDocument} from './record-document.js';
import {recordReferenceLocation} from './record-reference-location.js';
import {RetainedRecordDocuments,retainedRecordPointer} from './retained-record-documents.js';
import {retainRecordOrigin,recordOrigin,retainRecordOwnerExternalReference} from './record-owner-provenance.js';
import {referenceNamespaceMatches,referenceSourceOwners} from './research-reference-namespace.js';
import {validMaterialReference,materialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {schemaReferences,measurementReferences} from './web/measurement-model.js';
import {analysisMethodReferences} from './web/analysis-model.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {readRecordOwnerTransfer,readRecordOwnerPreviousTransfer} from './record-owner-transfer-state.js';
import {stageRecordOwnerMaterialIdentity,stageMaterialReturnRetirement} from './material-visibility.js';
import {readRecordOwnerMetadata,classifyRecordOwnerAuditMetadata,recordOwnerAuditPathKey,recordOwnerAuditMutablePath} from './record-owner-audit-metadata.js';
import {customFontId} from './web/font-catalogue.js';
import {stageRecordOwnerRevision} from './record-owner-read-visibility.js';
import {workflowReceiptKeys,pendingEvidenceReceiptKeys,recordOwnerWorkflows} from './record-owner-workflows.js';
const kinds=['all','artifact','dataset','analysis','collection'];
const empty=kind=>({format:1,kind,root:null,count:0,chunkSize:64});
const stateKey=id=>'record-owner-evidence-progress:'+id;
const partKey=(id,name)=>'record-owner-evidence-part:'+id+':'+digest(name);
const dataKey=(id,name)=>'record-owner-evidence-part-data:'+id+':'+digest(name);
const auditKey=(id,name)=>'record-owner-evidence-audit:'+id+':'+digest(name);
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
function boundedSet(){const values=new Set();return {has:key=>values.has(key),add(key){if(values.size>=128)values.delete(values.values().next().value);values.add(key);}};}
async function* objectNames(workspace,prefix,{signal}={}){let after=null;do{const page=await workspace.catalogue(store=>store.objectIdPage(prefix,{after,signal}));yield* page.items;after=page.next;}while(after);}
async function visitValue(value,visit){if(!value||typeof value!=='object')return;await visit(value);for(const child of Object.values(value))if(child&&typeof child==='object')await visitValue(child,visit);}
async function visitTree(document,revision,visit,{signal,property}={}){
 signal?.throwIfAborted();const node=await document.tree.node(revision);if(node.type==='inline'){if(['font','headingFont'].includes(property))await visit({[property]:node.value});await visitValue(node.value,visit);return;}
 if(['object','array','keyed-array'].includes(node.type))for await(const child of document.tree.children(node))await visitTree(document,child.value,visit,{signal,property:child.name});
}
export async function prepareRecordOwnerEvidence(source,target,receipt,{write,signal,check=async()=>{},checkpoint=async()=>{},saveProgress=async()=>{}}={}){
 const recordId=receipt.command.recordId,materials=new ResearchMaterials(source),incoming=new ResearchMaterials(target);
 let state=await target.catalogue(store=>store.object(stateKey(receipt.id)));
 if(!state)state={version:1,segmentId:receipt.progress.segmentId,recordId,createdAt:receipt.createdAt,sequences:Object.fromEntries(kinds.map(kind=>[kind,empty('references')])),revisions:empty('references'),files:empty('files'),audit:empty('files'),headsAfter:null,ready:false};
 if(state.version!==1||state.recordId!==recordId||state.segmentId!==receipt.progress.segmentId)damaged();
 const origin=async ref=>write(async store=>{
  await retainRecordOrigin(store,{...ref,sourceOwner:receipt.sourceOwner,transferId:receipt.id});
  await source.catalogue(async from=>{for await(const sourceOwner of referenceSourceOwners(from,ref))await retainRecordOrigin(store,{...ref,sourceOwner,transferId:receipt.id});});
 });
 await origin({kind:'record',id:recordId});
 // A prepared receipt can predate retained former identities. Reconcile only
 // its selected identities before verification; immutable evidence is reused.
 if(state.ready){const seen=boundedSet();for await(const ref of incoming.sequences.items(state.revisions)){signal?.throwIfAborted();const key=ref.kind+':'+ref.id;if(!seen.has(key)){await origin(ref);seen.add(key);}}return state;}
 const persist=async store=>{await store.putObject(stateKey(receipt.id),state);};
 const retainAudit=async(name,text)=>write(async store=>{
  const key=recordOwnerAuditPathKey(name),prior=await store.object(key),entry={name,sha256:digest(text),bytes:Buffer.byteLength(text)},part={version:1,transferId:receipt.id,recordId,relative:name,text};
  const retained=await store.object(auditKey(receipt.id,name));if(retained){if(serialize(retained)!==serialize(part))damaged();return;}
  if(prior?.transferId===receipt.id){if(prior.sha256!==entry.sha256||prior.bytes!==entry.bytes)damaged();return;}
  const returned=await readRecordOwnerPreviousTransfer(store,receipt),mutable=recordOwnerAuditMutablePath(name);let preserveAlias=false;
  if(prior){const owner=await readRecordOwnerTransfer(store,prior.transferId);if(!owner||owner.targetOwner.workspaceId!==receipt.targetOwner.workspaceId||!['cancelled','complete'].includes(owner.phase)||prior.recordId!==recordId||(!returned||!mutable)&&(prior.sha256!==entry.sha256||prior.bytes!==entry.bytes))throw new AppError('RECORD_TRANSFER_EXISTS');preserveAlias=!mutable&&owner.phase==='complete';}
  const local=await target.readMetadata(name,16*1024*1024),visible=await readRecordOwnerMetadata(target,name,16*1024*1024),overlay={};
  if(local!==null&&local!==text){if(!returned||!mutable)throw new AppError('RECORD_TRANSFER_EXISTS');overlay.previousSha256=digest(local);}
  if(returned&&prior&&mutable){
   const previous=await readRecordOwnerTransfer(store,prior.transferId),candidate=previous.phase==='complete'?prior.transferId:prior.previousTransferId;
   if(candidate){const previousPart=await store.object(auditKey(candidate,name));if(previousPart?.text===visible){overlay.previousTransferId=candidate;if(local!==null)overlay.previousSha256=digest(local);}}
  }
  await store.putObject(auditKey(receipt.id,name),part);if(!preserveAlias)await store.putObject(key,{version:1,relative:name,recordId,transferId:receipt.id,sha256:entry.sha256,bytes:entry.bytes,...overlay});state.audit=await incoming.sequences.append(state.audit,[entry]);await persist(store);
 });
 const emit=async part=>{
  signal?.throwIfAborted();
  if(part.kind==='metadata'){const existing=await target.readMetadata(part.name,Math.max(Buffer.byteLength(part.content)+1,16*1024*1024));if(existing!==null){
   if(serialize(JSON.parse(existing))!==serialize(JSON.parse(part.content))){
    const pin=/^\.observanda\/materials\/records\/([a-f0-9-]{36})\/([a-f0-9]{64})\.json$/.exec(part.name);
    if(!pin||pin[1]!==recordId){if(!recordOwnerAuditMutablePath(part.name))throw new AppError('RECORD_TRANSFER_EXISTS');await retainAudit(part.name,part.content);return;}
    await new RetainedRecordDocuments(target).check({kind:'record',id:recordId,revision:pin[2]},{signal,raw:true});
   }part={...part,content:existing};
  }}
  const prior=await target.catalogue(store=>store.object(partKey(receipt.id,part.name)));
  const bytes=part.kind==='original'?part.content.size:Buffer.byteLength(part.content),sha256=part.kind==='original'?part.content.sha256:digest(part.content),entry={name:part.name,kind:part.kind,bytes,sha256};
  if(prior){if(serialize(prior)!==serialize(entry))damaged();return;}
  if(part.kind==='original'){
   const file=target.metadataPath(part.name);await privateDirectory(target.root,path.posix.dirname(part.name));
   const present=!!await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(present)await new FileContent(target,file,bytes,sha256).verify({signal,onProgress:check});
   await write(store=>retainRecordOwnerResource(store,{kind:'file',relative:part.name,bytes,sha256},{present,receipt}));
   if(!present)await part.content.copyTo(target,file,{signal,check,resume:true});
  }
  await write(async store=>{
   if(part.kind==='metadata'){
    const pin=/^\.observanda\/materials\/records\/([a-f0-9-]{36})\/([a-f0-9]{64})\.json$/.exec(part.name);if(pin){if(pin[1]!==recordId)damaged();await stageRecordOwnerRevision(store,receipt,pin[2]);}
    const previous=await target.readMetadata(part.name,Math.max(bytes+1,16*1024*1024));if(previous!==null&&previous!==part.content)throw new AppError('RECORD_TRANSFER_EXISTS');await retainRecordOwnerResource(store,{kind:'object',key:'metadata:'+part.name,revision:digest(serialize({text:part.content}))},{present:previous!==null,receipt,dependencies:await recordOwnerMetadataDependencies(store,part.name,part.content)});if(previous===null)await target.writeMetadata(part.name,part.content);
   }
   if(part.kind==='metadata')await store.putObject(dataKey(receipt.id,part.name),{version:1,transferId:receipt.id,recordId,relative:part.name,text:part.content});
   state.files=await incoming.sequences.append(state.files,[entry]);await store.putObject(partKey(receipt.id,part.name),entry);await persist(store);
  });
 };
 const transfer=new ResearchTransfer(source,new Set([recordId]),[receipt.command.sourceNotebookId],emit);transfer.mediaIds=boundedSet();transfer.sequenceNodes=boundedSet();
 const sourceFonts=new WorkspaceFonts(source);
 const font=async id=>{
  const value=await sourceFonts.get(id,{includeSource:true}),{bytes,sourceText,...entry}=value;void bytes;
  await emit({kind:'metadata',name:'.observanda/fonts/'+id+'.json',content:sourceText});
  await write(async store=>{const library=new WorkspaceFonts(target),list=await library.list(),prior=list.find(value=>value.id===id);if(prior)return;if(list.length>=64)throw new AppError('FONT_LIMIT');const key='metadata:.observanda/fonts/'+id+'.json',retained=await store.object(key);await journalRecordOwnerMutation(store,receipt,{kind:'font',key:id},null,entry,{dependencies:[{kind:'object',key,revision:digest(serialize(retained))}]});await target.writeMetadata('.observanda/fonts/library.json',JSON.stringify([...list,entry]));});
 };
 const external=async ref=>{
  const local=await source.catalogue(store=>referenceNamespaceMatches(store,ref));
  if(ref.workspaceId===receipt.targetOwner.workspaceId){await incoming.read(ref);return;}
  if(local&&ref.kind==='record')await source.catalogue(store=>recordReferenceLocation(store,ref.id,ref.revision));
  else if(local)await materials.read(ref);
  // A readable former address keeps its original namespace. Local readability
  // does not rewrite a reference to the owner's current namespace.
  const prior=local&&ref.workspaceId&&ref.workspaceId!==receipt.sourceOwner.workspaceId?await source.catalogue(store=>recordOrigin(store,ref)):null;
  const owner=ref.workspaceId&&ref.workspaceId!==receipt.sourceOwner.workspaceId?(prior?.sourceOwner??{projectId:null,labBookId:null,workspaceId:ref.workspaceId}):receipt.sourceOwner;
  await write(store=>retainRecordOwnerExternalReference(store,receipt,materialReference(ref),{sourceOwner:owner}));
 };
 await withScratch(async inspected=>withMaterialTraversal(async traversal=>{
  const choice=async(value,enqueue)=>{
   if(typeof value.scope!=='string'||!Object.hasOwn(value,'root')||!Number.isSafeInteger(value.ordinal))return;let scope;try{scope=JSON.parse(value.scope);}catch{return;}
   if(scope?.recordId!==recordId||scope.kind!=='artifact'||!researchId(scope.workspaceId))return;
   if(!await inspected.add('choice:'+digest(serialize(value))))return;
   await source.catalogue(async from=>{
    const tree=materials.choices.tree(from);
    async function visit(ref){if(!ref)return;signal?.throwIfAborted();const node=await tree.node(ref);await visit(node.left);await visit(node.right);const item=await materials.choices.item(from,node);await enqueue(item.ref);
     await write(async store=>{for(const [slot,value,dependencies] of [['material-choice:'+node.revision,item,[]],[tree.slot(ref),node,[{kind:'state',key:'material-choice:'+node.revision,revision:digest(serialize(item))},...[node.left,node.right].filter(Boolean).map(child=>({kind:'state',key:tree.slot(child),revision:child.hash}))]]]){const prior=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(prior&&digest(serialize(store.decode('state',slot,prior.payload)))!==digest(serialize(value)))damaged();await retainRecordOwnerResource(store,{kind:'state',key:slot,revision:digest(serialize(value))},{present:!!prior,dependencies});if(!prior)await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,value));}});
    }await visit(value.root);
   });
  };
  const inspect=async(value,enqueue)=>{
   await choice(value,enqueue);
   if(value.kind==='retained'&&value.document?.format==='figure-document'&&await inspected.add('figure:'+digest(serialize(value.document)))){const {RetainedFigureDocuments}=await import('./retained-figure-document.js');const reader=await new RetainedFigureDocuments(source,{readOnly:true,signal}).open(value);for await(const part of reader.blocks())await emit({kind:'metadata',name:part.path,content:JSON.stringify(part.node,null,2)+'\n'});}
   if(validMaterialReference(value))await enqueue(materialReference(value));
   if(value.format===1&&['pages','columns','references','files','upload-chunks','aggregation-members','cells','cell-text','domain-components','calculation-bindings','calculation-nodes','calculation-outputs','calculation-edges','calculation-lineage','calculation-row-bindings','calculation-source-locators'].includes(value.kind)&&Object.hasOwn(value,'root')&&Object.hasOwn(value,'count'))await transfer.sequence(value);
   for(const key of ['font','headingFont'])if(customFontId(value[key])&&await inspected.add('font:'+value[key]))await font(value[key]);
  };
  const audit=async name=>{
   if(!await inspected.add('audit:'+name))return;const classified=await classifyRecordOwnerAuditMetadata(source,name);if(!classified||classified.recordId!==recordId)return;
   const text=await readRecordOwnerMetadata(source,name,16*1024*1024);if(text===null)damaged();const value=JSON.parse(text);
   if(classified.direct)await emit({kind:'metadata',name,content:text});
   else await retainAudit(name,text);
   await visitValue(value,item=>inspect(item,ref=>inspected.put('seed:'+JSON.stringify(ref),ref)));
  };
  async function* seeds(){
   const workflows=await recordOwnerWorkflows(source,recordId,{signal,onProgress:completed=>checkpoint('evidence-workflows',{completed})});
   if(workflows){
    for(const {key,prefix,folder} of workflows.names){await audit(key.slice(9));if(prefix&&folder!=='imports')for await(const child of objectNames(source,prefix,{signal}))await audit(child.slice(9));}
    for(const folder of ['intakes','drafts'])for(const suffix of ['/'+recordId+'/', '/'+recordId+'-order'])for await(const key of objectNames(source,'metadata:.observanda/materials/'+folder+'/by-record'+suffix,{signal}))await audit(key.slice(9));
   }else{
   const ranges={objectIdPage:(...args)=>source.catalogue(store=>store.objectIdPage(...args)),objectIdentity:key=>source.catalogue(store=>store.objectIdentity(key))};
   for await(const {key,prefix,folder} of workflowReceiptKeys(ranges,{signal})){
    const classified=await classifyRecordOwnerAuditMetadata(source,key.slice(9));if(classified?.recordId!==recordId)continue;
    await audit(key.slice(9));
    if(folder!=='imports')for await(const child of objectNames(source,prefix,{signal}))await audit(child.slice(9));
   }
   // Record feeds live beside the workflow identities and are selected directly.
   for(const folder of ['intakes','drafts'])for(const suffix of ['/'+recordId+'/', '/'+recordId+'-order'])for await(const key of objectNames(source,'metadata:.observanda/materials/'+folder+'/by-record'+suffix,{signal}))await audit(key.slice(9));
   for(const prefix of ['.observanda/materials/associations/','.observanda/materials/corrections/','.observanda/intake/','.observanda/jobs/'])for await(const key of objectNames(source,'metadata:'+prefix,{signal}))await audit(key.slice(9));
   }
   for await(const key of objectNames(source,'record-owner-evidence-audit-path:',{signal})){const alias=await source.catalogue(store=>store.object(key));if(alias?.recordId===recordId)await audit(alias.relative);}
   let after='';for(;;){const rows=await source.catalogue(store=>store.db.all('SELECT revision FROM records WHERE id=$1 AND revision COLLATE "C">$2 ORDER BY revision COLLATE "C" LIMIT 32',recordId,after));if(!rows.length)break;
    for(const row of rows){signal?.throwIfAborted();await source.catalogue(store=>withRecordDocument(store,recordId,row.revision,async document=>{
     await visitTree(document,document.root,value=>inspect(value,ref=>inspected.put('seed:'+JSON.stringify(ref),ref)),{signal});
     const attachments=await document.tree.select(document.root,['attachments']);if(attachments)for await(const item of document.items(['attachments'],{signal})){const id=(await document.tree.selected(item.value,['id'])).value;if(!researchId(id))damaged();await transfer.asset(id);}
    }));after=row.revision;}
   }
   for await(const value of inspected.items())if(validMaterialReference(value))yield value;
   for await(const name of source.metadataNames('.observanda/materials/records/'+recordId,{signal}))if(/^[a-f0-9]{64}\.json$/.test(name))yield {kind:'record',id:recordId,revision:name.slice(0,-5)};
   let cursor=null;do{const page=await materials.index.page({recordId,cursor,limit:32,signal});for(const head of page.items)yield head;cursor=page.next;}while(cursor);
  }
  await traversal.walk(seeds(),async(ref,enqueue)=>{
   signal?.throwIfAborted();ref=await materials.referenceAddress(ref);const local=await source.catalogue(store=>referenceNamespaceMatches(store,ref));
   if(!local||ref.kind==='record'&&ref.id!==recordId){await external(ref);return;}
   if(ref.kind==='record'){
    const name='.observanda/materials/records/'+recordId+'/'+ref.revision+'.json',legacy=await source.readMetadata(name,16*1024*1024);
    if(legacy!==null&&!retainedRecordPointer(JSON.parse(legacy))){await new RetainedRecordDocuments(source).check(ref,{signal});const original=JSON.parse(legacy);await visitValue(original,value=>inspect(value,enqueue));for(const attachment of original.attachments??[])await transfer.asset(attachment.id);await emit({kind:'metadata',name,content:legacy});return;}
    const found=await target.catalogue(async store=>{const history=store.historyIndex(recordId);return history.lookup(await history.head(),'view',ref.revision,{optional:true});});if(!found)throw new AppError('MATERIAL_MISSING');
    const pointer={format:'observanda-retained-record',version:1,id:recordId,revision:ref.revision,storageRevision:found.item.revision,snapshotId:found.item.snapshotId};
    await emit({kind:'metadata',name:'.observanda/materials/records/'+recordId+'/'+ref.revision+'.json',content:JSON.stringify(pointer)+'\n'});return;
   }
   const doc=await materials.read(ref);if(doc.recordId!==recordId){await external(ref);return;}
   await origin(ref);
   await write(store=>stageRecordOwnerMaterialIdentity(target,receipt,ref,doc,{store}));
   if(!await materials.current(ref.id))await write(()=>stageMaterialReturnRetirement(incoming,receipt,ref));
   if(doc.previous)await enqueue({...ref,revision:doc.previous});for await(const input of materials.references(doc.content))await enqueue(input);for await(const output of materials.references(doc.content,'outputs'))await enqueue(output);if(doc.content.acquisition)await enqueue(doc.content.acquisition);
   for(const slot of ['pageIndex','schemaIndex','inputsIndex','outputsIndex','aggregationMembersIndex','schemaInputsIndex','plotPointsIndex','plotMembersIndex','graphBindingsIndex','graphNodesIndex','graphOutputsIndex'])await transfer.sequence(doc.content[slot]);
   if(doc.content.figure?.kind==='retained'){const {RetainedFigureDocuments}=await import('./retained-figure-document.js');const figure=await new RetainedFigureDocuments(source,{readOnly:true,signal}).open(doc.content.figure);for await(const part of figure.blocks())await emit({kind:'metadata',name:part.path,content:JSON.stringify(part.node,null,2)+'\n'});}
   if(doc.content.comparison&&doc.content.summary?.version===2)for await(const part of materials.comparisons.index(doc.content.summary).metadata())await emit({kind:'metadata',name:part.name,content:JSON.stringify(part.value)});
   if(doc.kind==='dataset'){
    for await(const column of materials.iterateDatasetColumns(doc))for(const input of schemaReferences(column))await enqueue(input);
    for(let index=0;index<materials.datasetPageCount(doc);index++){signal?.throwIfAborted();const info=[2,3].includes(doc.content.datasetFormat)?await materials.sequences.item(doc.content.pageIndex,index):doc.content.pages[index],{rows}=await materials.retainedDatasetPage(doc,index,{metadataOnly:true});await emit({kind:'metadata',name:'.observanda/materials/tables/'+info.hash+'.json',content:JSON.stringify(rows)});}
   }
   await emit({kind:'metadata',name:'.observanda/materials/objects/'+doc.id+'/'+ref.revision+'.json',content:JSON.stringify(doc)+'\n'});
   if(doc.content.measurement)for(const input of measurementReferences(doc.content.measurement))await enqueue(input);if(doc.content.method)for(const input of analysisMethodReferences(doc.content.method))await enqueue(input);
   if(doc.kind==='artifact'){const content=await materials.originalContent(doc);await emit({kind:'original',name:transfer.relative(content.file),content});}
   await write(async store=>{const identity='record-owner-evidence-revision:'+receipt.id+':'+ref.kind+':'+ref.id+':'+ref.revision;if(!await store.object(identity)){state.revisions=await incoming.sequences.append(state.revisions,[materialReference(ref)]);await store.putObject(identity,{version:1,ref:materialReference(ref)});await persist(store);}});
  });
 }),{signal});
 // Current discovery is staged after immutable reachability is complete. The
 // saved key makes replay append each identity exactly once after interruption.
 let cursor=null;do{const page=await materials.index.page({recordId,cursor,limit:32,signal});for(const head of page.items){
  const identity='record-owner-evidence-head:'+receipt.id+':'+head.id;if(await target.catalogue(store=>store.object(identity)))continue;
  const {stagedBatch,ownerTransfer,...plain}=head;void stagedBatch;void ownerTransfer;const normalized={...plain,ownerTransfer:receipt.id},doc=await materials.read(head);
  await write(async store=>{await incoming.index.stageTransferHead(normalized,doc,{transferId:receipt.id});const ref={kind:head.kind,id:head.id,revision:head.revision};for(const kind of ['all',head.kind])state.sequences[kind]=await incoming.sequences.append(state.sequences[kind],[ref]);await store.putObject(identity,ref);await persist(store);});
  await saveProgress(state);await checkpoint('evidence',{id:receipt.id,recordId,completed:state.sequences.all.count});
 }cursor=page.next;}while(cursor);
 // Fixed record receipt roots contain no unrelated owner data. Their original
 // revision hashes and publication addresses remain unchanged after the move.
 for(const prefix of ['.observanda/materials/figure-edits/'+recordId,'.observanda/run-readiness/records/'+recordId,'.observanda/run-readiness/completed/'+recordId,'.observanda/run-readiness/receipts/'+recordId]){
  const exact=await readRecordOwnerMetadata(source,prefix+'.json',16*1024*1024);if(exact!==null)await emit({kind:'metadata',name:prefix+'.json',content:exact});
  for await(const key of objectNames(source,'metadata:'+prefix+'/',{signal})){const name=key.slice(9),text=await readRecordOwnerMetadata(source,name,16*1024*1024);if(text===null)damaged();await emit({kind:'metadata',name,content:text});}
 }
 state.ready=true;await write(persist);await saveProgress(state);return state;
}
export async function activateRecordOwnerEvidence(target,receipt,descriptor,{store,signal}={}){
 signal?.throwIfAborted();if(!descriptor?.ready||descriptor.recordId!==receipt.command.recordId||descriptor.segmentId!==receipt.progress.segmentId||serialize(await store.object(stateKey(receipt.id)))!==serialize(descriptor))damaged();
 await new ResearchMaterials(target).index.publishTransfer({id:receipt.id,segmentId:descriptor.segmentId,recordId:descriptor.recordId,createdAt:descriptor.createdAt,sequences:descriptor.sequences});
}
export async function verifyRecordOwnerEvidence(target,receipt,descriptor,{signal,check}={}){
 if(!descriptor||descriptor.version!==1||descriptor.recordId!==receipt.command.recordId||descriptor.segmentId!==receipt.progress.segmentId)damaged();const materials=new ResearchMaterials(target);
 for(const kind of kinds)materials.sequences.validate(descriptor.sequences[kind]);
 // Lifecycle checks remain ordered even when independent originals overlap.
 let checks=Promise.resolve();const onProgress=check?()=>{checks=checks.then(()=>check());return checks;}:undefined;
 for await(const result of adaptiveReadMap(materials.sequences.items(descriptor.files),async(entry,signal)=>{
  signal.throwIfAborted();if(entry.kind==='original')await new FileContent(target,target.metadataPath(entry.name),entry.bytes,entry.sha256).verify({signal,onProgress,reportProgress:false});else{const saved=await target.catalogue(store=>store.object(dataKey(receipt.id,entry.name))),text=saved?.text;if(saved?.version!==1||saved.transferId!==receipt.id||saved.recordId!==descriptor.recordId||saved.relative!==entry.name||typeof text!=='string'||Buffer.byteLength(text)!==entry.bytes||digest(text)!==entry.sha256)damaged();if(receipt.phase!=='complete'&&await target.readMetadata(entry.name,Math.max(entry.bytes+1,16*1024*1024))!==text)damaged();}
 },{signal}))void result;
 for await(const ref of materials.sequences.items(descriptor.revisions)){signal?.throwIfAborted();const doc=await materials.readStored(ref);if(doc.recordId!==descriptor.recordId)damaged();}
 for await(const ref of materials.sequences.items(descriptor.sequences.all)){signal?.throwIfAborted();const doc=await materials.readStored(ref);if(doc.recordId!==descriptor.recordId||doc.kind!==ref.kind)damaged();if(receipt.phase!=='complete'){const head=await materials.current(ref.id,{includeStaged:true});if(!head||head.ownerTransfer!==receipt.id||head.revision!==ref.revision)damaged();}}
 return {revisions:descriptor.revisions.count,heads:descriptor.sequences.all.count,files:descriptor.files.count};
}
// Read-only admission runs before the fence. Its authenticated object root is
// rechecked in the short source transaction, closing start/queue races without
// keeping a writer while scanning completed receipts.
export async function recordOwnerEvidenceAdmission(source,recordId,{signal}={}){
 const selected=await recordOwnerWorkflows(source,recordId,{signal});if(selected){if(selected.pending)throw new AppError('RECORD_TRANSFER_PENDING');return selected.proof;}
 return source.catalogue(async store=>{
  const materials=new ResearchMaterials(source),proof=digest(serialize(await store.objectIndex().head()));
  for await(const key of pendingEvidenceReceiptKeys(store,{signal})){
   signal?.throwIfAborted();const name=key.slice(9);
   if(!/^(?:\.observanda\/materials\/(?:imports\/[a-f0-9-]{36}\/session|intakes\/[a-f0-9-]{36}\/batch|drafts\/[a-f0-9-]{36}\/draft|associations\/[a-f0-9-]{36})|\.observanda\/intake\/proposals\/[a-f0-9-]{36}|\.observanda\/jobs\/[a-f0-9-]{36})\.json$/.test(name))continue;
   const text=await source.readMetadata(name,16*1024*1024);let value;try{value=JSON.parse(text);}catch{damaged();}
   const owner=value.recordId??value.command?.recordId??value.manifest?.recordId??value.scope;if(owner!==recordId)continue;
   let pending;if(name.includes('/imports/'))pending=!(await materials.importState(value.id)).completed;
   else if(name.startsWith('.observanda/jobs/'))pending=['queued','running'].includes(value.state);
   else pending=!['completed','cancelled'].includes(value.state);
   if(pending)throw new AppError('RECORD_TRANSFER_PENDING');
  }
  return proof;
 });
}
export async function checkRecordOwnerEvidenceAdmission(store,proof){if(proof!==digest(serialize(await store.objectIndex().head())))throw new AppError('CONFLICT');}