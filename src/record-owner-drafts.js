import {catalogueRequiresRetainedFigures,requireRetainedFigures,catalogueRequiresFigureAuthoring,requireFigureAuthoring} from './catalogue-format.js';
import {catalogueFormat,catalogueRequiresNestedAttemptCollections,requireNestedAttemptCollections} from './catalogue-format.js';
import {RetainedTableIndex} from './retained-table-index.js';
// Selected checkpoint portability keeps original identities separate from the
// destination recovery envelope. Staged work is visible only after activation.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {readRecordOwnerFence,readRecordOwnerTransfer,withRecordOwnerTransferWrite} from './record-owner-transfer-state.js';
import {copyRecordOwnerValue} from './record-owner-document.js';
import {RecordDocument} from './record-document.js';
import {withRecordBlockStore,recordBlockResource} from './record-block-store.js';
import {ObjectIndex} from './object-index.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {MAX_RECORD_COMMAND_BYTES} from './web/research-capacity.js';
import {retainRecordOwnerResource,journalRecordOwnerMutation,journalRecordOwnerMutations} from './record-owner-resources.js';
const hash=value=>digest(serialize(value)),fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const prefix='record-owner-draft-',originKey=id=>prefix+'origin:'+id,originalKey=revision=>prefix+'original:'+revision;
const originArchive=(transferId,id)=>prefix+'origin:'+transferId+':'+id;
const draftPath=id=>'.observanda/drafts/'+id+'.json';
const records=draft=>Array.isArray(draft?.changes)?draft.changes.map(change=>change.record?.id).filter(researchId):researchId(draft?.base?.recordId)?[draft.base.recordId]:[];
const parse=value=>{if(value===null||value===undefined)return null;if(typeof value.text!=='string')return value;try{return JSON.parse(value.text);}catch{fail();}};
const owner=(draft,revision,position)=>({workspaceId:draft.workspaceId,recordId:records(draft)[position],draftId:draft.id,draftRevision:revision,position});
export const validDraftOriginOwner=value=>value&&['workspaceId','recordId','draftId'].every(key=>researchId(value[key]))&&revisionId(value.draftRevision)&&Number.isSafeInteger(value.position)&&value.position>=0;
async function retired(store,recordId){const fence=await readRecordOwnerFence(store,recordId);return fence?.direction==='outgoing'&&fence.transfer.phase==='complete';}
async function authorized(store,value){
 if(value?.version!==1||!researchId(value.transferId)||!researchId(value.recordId)||!revisionId(value.fingerprint))fail();
 const receipt=await readRecordOwnerTransfer(store,value.transferId);
 if(!receipt||value.fingerprint!==receipt.fingerprint||value.recordId!==receipt.command.recordId||receipt.targetOwner.workspaceId!==(await store.snapshot()).metadata.id)fail();return receipt;
}
export async function recordOwnerDraftOrigin(store,id){
 const pointer=await store.object(originKey(id));if(!pointer)return null;
 if(pointer.version!==1||!researchId(pointer.transferId)||!revisionId(pointer.revision))fail();const value=await store.object(originArchive(pointer.transferId,id));if(!value||hash(value)!==pointer.revision)fail();
 if(value.version!==1||value.id!==id||!revisionId(value.revision)||!validDraftOriginOwner(value.owner)||value.owner.recordId!==value.recordId||value.reviewId!==null&&!revisionId(value.reviewId))fail();
 await authorized(store,value);return value;
}
export async function projectRecordOwnerDraft(workspace,result,{includePending=false}={}){
 if(!result||await workspace.storageKind()!=='catalogue')return result;
 return workspace.catalogue(async store=>{
  const {draft}=result,imported=await recordOwnerDraftOrigin(store,draft.id);
  if(imported&&imported.revision===result.revision){
   if(!includePending&&(await authorized(store,imported)).phase!=='complete')return null;
   Object.defineProperty(result,'origin',{value:{owners:[imported.owner],reviewIds:[imported.reviewId],transfers:[imported.transferId]},configurable:true});
  }
  if(includePending)return result;
  const ids=records(draft),positions=[];for(let i=0;i<ids.length;i++)if(!await retired(store,ids[i]))positions.push(i);
  if(!positions.length)return null;if(positions.length===ids.length)return result;
  if(!Array.isArray(draft.changes))fail();
  const projected={...draft,changes:positions.map(position=>draft.changes[position])},value={draft:projected,revision:hash(projected)};
  Object.defineProperty(value,'origin',{value:{owners:positions.map(position=>owner(draft,result.revision,position)),reviewIds:positions.map(()=>null)}});return value;
 });
}
export async function recordOwnerDraftMetadataRecords(store,id,value){
 const parsed=parse(value);if(!parsed)return [];
 let ids=[],match;
 if((match=/^metadata:\.observanda\/drafts\/([a-f0-9-]{36})\.json$/.exec(id)))ids=records(parsed);
 else if((match=/^metadata:\.observanda\/(?:record-draft-blocks|record-draft-transfers)\/([a-f0-9-]{36})(?:[/.])/.exec(id)))ids=records(parse(await store.object('metadata:'+draftPath(match[1]))));
 else if(id.startsWith('metadata:.observanda/draft-list/'))ids=records(parse(await store.object('metadata:'+draftPath(parsed.id))));
 else if(id.startsWith('record-draft-edit-operation:')){const node=await store.object('record-draft-edit:'+parsed.revision);ids=[node?.owner?.recordId].filter(researchId);}
 else if(id.startsWith('record-draft-recovery:')){
  const draft=parse(await store.object('metadata:'+draftPath(parsed.draftId)));ids=records(draft);
  if(Array.isArray(draft?.changes)){
   const changes=[];for(const change of draft.changes)if(!await retired(store,change.record.id))changes.push(change);
   // The surviving selection has its own exact revision and receipt count.
   // An old or mismatched ledger still belongs to every original record.
   if(changes.length&&changes.length<ids.length&&parsed.workspaceId===draft.workspaceId&&parsed.count===changes.length&&id==='record-draft-recovery:'+draft.id+':'+parsed.draftRevision&&hash({...draft,changes})===parsed.draftRevision)ids=changes.map(change=>change.record.id);
  }
 }
 else ids=[parsed.recordId??parsed.owner?.recordId].filter(researchId);
 // Removing or updating a remaining sibling must not be fenced by the record
 // already retired out of its legacy multi-record checkpoint.
 if(/^metadata:\.observanda\/(?:drafts|draft-list|record-draft-blocks|record-draft-transfers)(?:[/.])/.test(id)){
  const visible=[];for(const recordId of ids)if(!await retired(store,recordId))visible.push(recordId);
  if(visible.length&&visible.length<ids.length&&serialize(await store.object(id))===serialize(value))return visible;return ids;
 }return ids;
}
export async function recordOwnerDraftArchived(store,kind,id){
 const value=await store.object(prefix+kind+':'+id);if(!value)return null;
 await authorized(store,value);const item=value.value;
 if(kind==='edit'&&hash(item)!==id||kind==='head'&&hash(item?.owner)!==id||kind==='review'&&item?.id!==id)fail();
 if((item?.recordId??item?.owner?.recordId)!==value.recordId)fail();return item;
}
export async function recordOwnerDraftPlanOrigin(store,result,position,row){
 const identity=result.origin?.owners[position];if(!identity)return null;
 if(!validDraftOriginOwner(identity))fail();
 const {RecordDraftEdits}=await import('./record-draft-edits.js'),edits=new RecordDraftEdits(store),editRevision=await edits.head({...identity,sourcePosition:identity.position});
 const original=parse(await store.object(originalKey(identity.draftRevision))),legacy=(original?JSON.parse(original.raw).formatVersion:null)!==4;
 const reviewId=result.origin.reviewIds[position]??hash([identity.draftId,identity.draftRevision,row?.revision??null,...(legacy?[identity.position]:[]),...(editRevision?[editRevision]:[])]);
 return {...identity,reviewId,...(result.origin.transfers?.[position]?{transferId:result.origin.transfers[position]}:{})};
}
export async function verifyDraftPlanOrigin(store,plan){
 if(!plan.origin)return;
 const origin=plan.origin;if(!validDraftOriginOwner(origin)||origin.recordId!==plan.recordId||!revisionId(origin.reviewId))fail();
 const original=await store.object(originalKey(origin.draftRevision));
 if(original){
  if(original.version!==1||original.workspaceId!==origin.workspaceId||original.id!==origin.draftId||digest(original.raw)!==origin.draftRevision)fail();
  const draft=JSON.parse(original.raw);if(records(draft)[origin.position]!==origin.recordId)fail();return;
 }
 const imported=researchId(origin.transferId)?await store.object(originArchive(origin.transferId,plan.draftId)):await recordOwnerDraftOrigin(store,plan.draftId);if(imported)await authorized(store,imported);if(!imported||imported.revision!==plan.draftRevision||serialize(imported.owner)!==serialize(Object.fromEntries(['workspaceId','recordId','draftId','draftRevision','position'].map(key=>[key,origin[key]]))))fail();
}
// Locate the selected array element in a validated legacy envelope. Strings
// and nested containers are skipped lexically so no sibling text is retained.
function selectedChangeRaw(raw,position){
 let at=0;const space=()=>{while(/\s/.test(raw[at]??'')&&at<raw.length)at++;};
 const string=()=>{const start=at++;while(at<raw.length){if(raw[at++]==='"')return raw.slice(start,at);if(raw[at-1]==='\\')at++;}fail();};
 const value=()=>{space();if(raw[at]==='"'){string();return;}if(raw[at]==='{'||raw[at]==='['){const end=raw[at++]==='{'?'}':']';for(;;){space();if(raw[at]===end){at++;return;}if(raw[at]===','||raw[at]===':'){at++;continue;}value();}}else{const start=at;while(at<raw.length&&!/[\s,}\]]/.test(raw[at]))at++;if(at===start)fail();}};
 space();if(raw[at++]!=='{')fail();for(;;){space();if(raw[at]==='}')fail();const key=JSON.parse(string());space();if(raw[at++]!==':')fail();space();
  if(key==='changes'){if(raw[at++]!=='[')fail();for(let index=0;;index++){space();const start=at;value();if(index===position)return raw.slice(start,at);space();if(raw[at++]!==',')fail();}}
  value();space();if(raw[at++]!==',')fail();
 }
}
async function putExact(store,id,value,{dependencies=[]}={}){const before=await store.object(id);if(before&&serialize(before)!==serialize(value))throw new AppError('CONFLICT');await retainRecordOwnerResource(store,{kind:'object',key:id,revision:hash(value)},{present:!!before,dependencies});if(!before)await store.putObject(id,value);}
async function archive(store,receipt,kind,id,value){
 const dependencies=[];
 if(kind==='review'||kind==='edit'){for(const revision of kind==='review'?[...Object.values(value.roots),value.conflicts]:[value.before,value.root,value.value])if(revision)dependencies.push(recordBlockResource(value.notebookId,value.generation,'value',revision));if(value.choices)dependencies.push({kind:'state',key:'record-draft-review:index:'+value.choices.hash,revision:value.choices.hash});}
 if(kind==='head'){const key=prefix+'edit:'+value.revision,edit=await store.object(key);if(edit)dependencies.push({kind:'object',key,revision:hash(edit)});}
 const key=prefix+kind+':'+id,prior=await store.object(key);if(prior){
  if(serialize(prior.value)!==serialize(value))throw new AppError('CONFLICT');await authorized(store,prior);
  // An interrupted copy may have retained this value before its graph was
  // complete. Bind that unchanged value to the retry's verification gate.
  if(await store.object('record-owner-drafts:'+prior.transferId))return;
 }
 const after={version:1,transferId:receipt.id,fingerprint:receipt.fingerprint,recordId:receipt.command.recordId,value};
 await journalRecordOwnerMutation(store,receipt,{kind:'object',key},prior,after,{dependencies});await store.putObject(key,after);
}
async function copyPlan(from,target,receipt,plan,options){
 const {write,signal}=options;
 await withRecordBlockStore(from,plan.notebookId,plan.generation,async blocks=>{
  const copy=async root=>{if(root!==null&&root!==undefined){const result=await copyRecordOwnerValue(new RecordDocument(blocks,root),target,options);if(result.root!==root)fail();}};
  for(const root of [...Object.values(plan.roots),plan.conflicts])await copy(root);
  const index=new ObjectIndex(from,{namespace:'record-draft-review:index:',immutable:true});
  async function branches(ref){if(!ref)return;signal?.throwIfAborted();const node=await index.node(ref);await branches(node.left);await branches(node.right);await copy(node.revision);await write(async store=>{
   const slot=index.slot(ref),previous=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(previous&&hash(store.decode('state',slot,previous.payload))!==ref.hash)fail();
   await retainRecordOwnerResource(store,{kind:'state',key:slot,revision:ref.hash},{present:!!previous,dependencies:[recordBlockResource(plan.notebookId,plan.generation,'value',node.revision),...[node.left,node.right].filter(Boolean).map(child=>({kind:'state',key:index.slot(child),revision:child.hash}))]});if(previous)return;
   await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,node));
  });}await branches(plan.choices);
 });
 await write(store=>archive(store,receipt,'review',plan.id,plan));
}
async function copyCorrections(from,target,receipt,options){
 const {RecordDraftEdits}=await import('./record-draft-edits.js'),edits=new RecordDraftEdits(from),{write,signal}=options,recordId=receipt.command.recordId;
 for(const sourcePrefix of ['record-draft-review:',prefix+'review:'])for await(const id of from.objectIdEntries(sourcePrefix,{signal})){
  const plan=sourcePrefix==='record-draft-review:'?await from.object(id):await recordOwnerDraftArchived(from,'review',id.slice(sourcePrefix.length));
  if(plan.recordId===recordId)await copyPlan(from,target,receipt,plan,options);
 }
 for(const sourcePrefix of ['record-draft-edit:',prefix+'edit:'])for await(const id of from.objectIdEntries(sourcePrefix,{signal})){
  const revision=id.slice(sourcePrefix.length),node=await edits.node(revision);if(node.owner.recordId!==recordId)continue;
  await withRecordBlockStore(from,node.notebookId,node.generation,async blocks=>{
   for(const root of [node.before,node.root,node.value])if((await copyRecordOwnerValue(new RecordDocument(blocks,root),target,options)).root!==root)fail();
  });await write(store=>archive(store,receipt,'edit',revision,node));
 }
 for(const sourcePrefix of ['record-draft-edit-head:',prefix+'head:'])for await(const id of from.objectIdEntries(sourcePrefix,{signal})){
  const head=sourcePrefix==='record-draft-edit-head:'?await from.object(id):await recordOwnerDraftArchived(from,'head',id.slice(sourcePrefix.length));
  if(head.owner.recordId===recordId)await write(store=>archive(store,receipt,'head',hash(head.owner),head));
 }
}
async function copyChunks(source,target,id,content,{write,signal}){
 const chunks=new RecordDraftChunks(source,id),tree=chunks.tree();
 const copy=async(kind,revision)=>{const file=chunks.prefix+'/'+kind+'/'+revision+'.json',raw=await source.readMetadata(file,2*1024*1024);if(raw===null)fail();await write(async store=>{
  const previous=await store.object('metadata:'+file);if(previous&&previous.text!==raw)throw new AppError('CONFLICT');const dependencies=[];
  if(kind==='nodes'){const node=JSON.parse(raw);for(const [part,version] of [['chunks',node.revision],...[node.left,node.right].filter(Boolean).map(ref=>['nodes',ref.hash])]){const key='metadata:'+chunks.prefix+'/'+part+'/'+version+'.json',value=await store.object(key);if(!value)fail();dependencies.push({kind:'object',key,revision:hash(value)});}}
  await retainRecordOwnerResource(store,{kind:'object',key:'metadata:'+file,revision:hash({text:raw})},{present:!!previous,dependencies});if(!previous)await target.writeMetadata(file,raw);
 });};
 async function visit(ref){if(!ref)return;signal?.throwIfAborted();const node=await tree.node(ref);await visit(node.left);await visit(node.right);await chunks.read('chunks',node.revision,2*1024*1024);await copy('chunks',node.revision);await copy('nodes',ref.hash);}await visit(content.root);
}
export async function prepareRecordOwnerDrafts(source,target,receipt,{write,signal,checkpoint=async()=>{}}={}){
 const {ResearchDrafts}=await import('./research-drafts.js'),sourceDrafts=new ResearchDrafts(source),targetDrafts=new ResearchDrafts(target),options={write,signal},recordId=receipt.command.recordId;
 const manifestId='record-owner-drafts:'+receipt.id,retained=await target.catalogue(store=>store.object(manifestId));if(retained)return retained;
 await write(()=>targetDrafts.index.ensureLocked(receipt.command.targetWorkspaceId));let count=0;
 await source.catalogue(async from=>{
  if(catalogueRequiresRetainedFigures(await catalogueFormat(from.db)))await write(store=>requireRetainedFigures(store.db));
  if(catalogueRequiresFigureAuthoring(await catalogueFormat(from.db)))await write(store=>requireFigureAuthoring(store.db));
  if(catalogueRequiresNestedAttemptCollections(await catalogueFormat(from.db)))await write(store=>requireNestedAttemptCollections(store.db));
  await copyCorrections(from,target,receipt,options);
  for await(const name of source.metadataNames('.observanda/drafts',{signal})){
   signal?.throwIfAborted();const id=name.slice(0,-5);if(!researchId(id)||name!==id+'.json')fail();
   const result=await sourceDrafts.read(id,{expand:false,header:true,raw:true}),draft=result.draft,position=records(draft).indexOf(recordId);if(position===-1)continue;
   const raw=await source.readMetadata(draftPath(id),MAX_RECORD_COMMAND_BYTES),sourceIdentity=owner(draft,result.revision,position);
   const projected=draft.changes?{formatVersion:draft.formatVersion,id:draft.id,workspaceId:receipt.command.targetWorkspaceId,updatedAt:draft.updatedAt,changes:[draft.changes[position]]}:{...draft,workspaceId:receipt.command.targetWorkspaceId},projectedRaw=serialize(projected),projectedRevision=digest(projectedRaw);
   const previousOrigin=await recordOwnerDraftOrigin(from,id),identity=previousOrigin?.revision===result.revision?previousOrigin.owner:sourceIdentity;
   const {RecordDraftEdits}=await import('./record-draft-edits.js'),edits=new RecordDraftEdits(from),editRevision=await edits.head({...identity,sourcePosition:identity.position});
   const reviewId=previousOrigin?.revision===result.revision?previousOrigin.reviewId:hash([id,result.revision,receipt.command.expectedStorageRevision,...(draft.formatVersion!==4?[position]:[]),...(editRevision?[editRevision]:[])]);
   const origin={version:1,id,revision:projectedRevision,recordId,transferId:receipt.id,fingerprint:receipt.fingerprint,owner:identity,reviewId,sourceCheckpoint:{workspaceId:draft.workspaceId,revision:result.revision},original:previousOrigin?.revision===result.revision?previousOrigin.original:draft.changes?.length>1?{kind:'selection',checkpointRevision:result.revision,position,header:{formatVersion:draft.formatVersion,id:draft.id,workspaceId:draft.workspaceId,updatedAt:draft.updatedAt},raw:selectedChangeRaw(raw,position)}:{kind:'checkpoint',raw}};
   await write(async store=>{
    const existing=await target.readMetadata(draftPath(id),MAX_RECORD_COMMAND_BYTES),prior=await recordOwnerDraftOrigin(store,id);
    if(existing!==null&&(!prior||prior.transferId!==receipt.id&&(await authorized(store,prior)).phase!=='cancelled'||prior.recordId!==recordId||digest(existing)!==prior.revision))throw new AppError('RECORD_DRAFT_EXISTS');
   });
   if(draft.document)await withRecordBlockStore(from,draft.document.notebookId,draft.document.generation,async blocks=>{if((await copyRecordOwnerValue(new RecordDocument(blocks,draft.document.root),target,options)).root!==draft.document.root)fail();});
   if(draft.preparationEdit?.identities.root)await withRecordBlockStore(from,draft.document.notebookId,draft.document.generation,async blocks=>{
    const index=new RetainedTableIndex(blocks,{namespace:'index',allowSparseBranches:true});let batch=[];const flush=async()=>{if(!batch.length)return;await write(store=>withRecordBlockStore(store,draft.document.notebookId,draft.document.generation,async destination=>{for(const {ref,node} of batch)if(await destination.put('index',node)!==ref.hash)fail();await destination.flush();}));batch=[];};
    const visit=async ref=>{signal?.throwIfAborted();const node=await index.node(ref);for(const child of node.children??[])await visit(child);for(const entry of node.entries??[])if((await copyRecordOwnerValue(new RecordDocument(blocks,entry.revision),target,options)).root!==entry.revision)fail();batch.push({ref,node});if(batch.length===32)await flush();};await visit(draft.preparationEdit.identities.root);await flush();
   });
   if(draft.content)await copyChunks(source,target,id,draft.content,options);
   await write(async store=>{
    const pointer={version:1,transferId:receipt.id,revision:hash(origin)},result={draft:projected,revision:projectedRevision},summary=targetDrafts.index.summary(result,hash({text:projectedRaw}));
    const values=[[originKey(id),pointer],['metadata:'+draftPath(id),{text:projectedRaw}],['metadata:'+targetDrafts.index.path(summary),{text:serialize(summary)}]],changes=[];
    for(const [key,after] of values)changes.push({address:{kind:'object',key},before:await store.object(key),after});
    const dependencies=[];if(draft.document)dependencies.push(recordBlockResource(draft.document.notebookId,draft.document.generation,'value',draft.document.root));
    if(draft.preparationEdit?.identities.root)dependencies.push(recordBlockResource(draft.document.notebookId,draft.document.generation,'index',draft.preparationEdit.identities.root.hash));
    if(draft.content?.root){const key='metadata:.observanda/record-draft-blocks/'+id+'/nodes/'+draft.content.root.hash+'.json',value=await store.object(key);if(!value)fail();dependencies.push({kind:'object',key,revision:hash(value)});}
    const archiveId=originArchive(receipt.id,id);await putExact(store,archiveId,origin,{dependencies});
    await journalRecordOwnerMutations(store,receipt,changes,{dependencies:[{kind:'object',key:archiveId,revision:hash(origin)},...dependencies]});
    await store.putObject(originKey(id),pointer);await target.writeMetadata(draftPath(id),projectedRaw);
    await targetDrafts.index.putLocked(result,hash({text:projectedRaw}));
   });count++;await checkpoint('draft',{id,recordId,count});
  }
 });
 const descriptor={version:1,id:receipt.id,recordId,count};await write(store=>putExact(store,manifestId,descriptor));await target.catalogue(store=>verifyRecordOwnerDrafts(store,{signal,receiptId:receipt.id}));return descriptor;
}
// Source-only legacy envelopes can include siblings. Retain them only after
// cancellation is forbidden, using the exact scalar proof saved at preparation.
export async function retainRecordOwnerSourceDrafts(source,target,receipt,{signal,check=async()=>{}}={}){
 const selected=prefix+'origin:'+receipt.id+':';let after=null;
 for(;;){
  signal?.throwIfAborted();await check();
  const batch=await target.catalogue(async store=>{
   const index=store.objectIndex(),head=await index.head(),rows=[];
   for await(const entry of index.entries(head,selected,after)){rows.push(entry.id);if(rows.length===32)break;}
   return rows;
  });if(!batch.length)return;
  for(const id of batch){
   signal?.throwIfAborted();await check();const origin=await target.catalogue(async store=>{const value=await store.object(id);await authorized(store,value);return value;}),expected=origin.sourceCheckpoint;
   // Earlier transfer versions retained this source envelope during preparation.
   if(!expected){after=id;continue;}
   if(Object.keys(expected).sort().join()!=='revision,workspaceId'||expected.workspaceId!==receipt.sourceOwner.workspaceId||!revisionId(expected.revision)||origin.transferId!==receipt.id||origin.recordId!==receipt.command.recordId)fail();
   await source.withLock(()=>source.catalogue(store=>withRecordOwnerTransferWrite(store,receipt,async()=>{
    const saved=await readRecordOwnerTransfer(store,receipt.id);if(saved?.fingerprint!==receipt.fingerprint||saved.phase!=='activating')throw new AppError('CONFLICT');
    const key=originalKey(expected.revision),prior=await store.object(key);
    if(prior){if(prior.id!==origin.id||prior.workspaceId!==expected.workspaceId||typeof prior.raw!=='string'||digest(prior.raw)!==expected.revision)fail();return;}
    const raw=await source.readMetadata(draftPath(origin.id),MAX_RECORD_COMMAND_BYTES);if(raw===null||digest(raw)!==expected.revision)fail();
    let draft;try{draft=JSON.parse(raw);}catch{fail();}if(draft.id!==origin.id||draft.workspaceId!==expected.workspaceId||!records(draft).includes(receipt.command.recordId))fail();
    await store.putObject(key,{version:1,id:origin.id,workspaceId:expected.workspaceId,recordId:receipt.command.recordId,transferId:receipt.id,fingerprint:receipt.fingerprint,raw});
   })));after=id;
  }
 }
}
export async function activateRecordOwnerDrafts(target,receipt,descriptor,{store}){
 void target;if(!descriptor||descriptor.version!==1||descriptor.id!==receipt.id||descriptor.recordId!==receipt.command.recordId||!Number.isSafeInteger(descriptor.count)||descriptor.count<0||serialize(await store.object('record-owner-drafts:'+receipt.id))!==serialize(descriptor))fail();
 // The engine commits its complete receipt with current membership. All staged
 // recovery rows observe that single gate in the same read snapshot.
}

export async function verifyRecordOwnerDrafts(store,{signal,receiptId=null}={}){
 const {verifyRecordDraftPlan,RecordDraftReview}=await import('./record-draft-review.js'),{RecordDraftEdits,verifyRecordDraftEdit}=await import('./record-draft-edits.js'),workspaceId=(await store.snapshot()).metadata.id;
 const ready=async wrapper=>{const receipt=await authorized(store,wrapper),manifest=await store.object('record-owner-drafts:'+receipt.id);if(receipt.phase==='complete'&&!manifest)fail();return !!manifest;};
 for await(const id of store.objectIdEntries(prefix+'origin:',{signal})){
  signal?.throwIfAborted();const tail=id.slice((prefix+'origin:').length);
  if(researchId(tail)){await recordOwnerDraftOrigin(store,tail);continue;}
  const [transferId,draftId,...extra]=tail.split(':');if(extra.length||!researchId(transferId)||!researchId(draftId))fail();
  const origin=await store.object(id),receipt=await authorized(store,origin);
  if(origin.sourceCheckpoint&&(Object.keys(origin.sourceCheckpoint).sort().join()!=='revision,workspaceId'||origin.sourceCheckpoint.workspaceId!==receipt.sourceOwner.workspaceId||!revisionId(origin.sourceCheckpoint.revision)))fail();
  if(origin.id!==draftId||origin.transferId!==transferId||!validDraftOriginOwner(origin.owner)||origin.owner.recordId!==origin.recordId||!revisionId(origin.revision)||!revisionId(origin.reviewId))fail();
  const original=origin.original;if(!original||typeof original.raw!=='string')fail();let retained;try{retained=JSON.parse(original.raw);}catch{fail();}
  let projected;
  if(original.kind==='checkpoint'){
   if(digest(original.raw)!==origin.owner.draftRevision||retained.id!==origin.owner.draftId||retained.workspaceId!==origin.owner.workspaceId||records(retained).length!==1||records(retained)[0]!==origin.recordId)fail();projected={...retained,workspaceId};
  }else if(original.kind==='selection'){
   if(original.checkpointRevision!==origin.owner.draftRevision||original.position!==origin.owner.position||retained.record?.id!==origin.recordId||original.header?.id!==origin.id||original.header?.workspaceId!==origin.owner.workspaceId||![1,2].includes(original.header?.formatVersion))fail();projected={...original.header,workspaceId,changes:[retained]};
  }else fail();
  if(hash(projected)!==origin.revision)fail();
  const pointer=await store.object(originKey(origin.id));
  if(pointer?.transferId===origin.transferId&&(receipt.phase!=='complete'||receiptId===origin.transferId)){const current=await store.object('metadata:'+draftPath(origin.id));if(typeof current?.text!=='string'||digest(current.text)!==origin.revision)fail();}
 }
 for await(const id of store.objectIdEntries('record-owner-drafts:',{signal})){
  const manifest=await store.object(id),receipt=await readRecordOwnerTransfer(store,manifest?.id);
  if(manifest?.version!==1||id!=='record-owner-drafts:'+manifest.id||manifest.recordId!==receipt?.command.recordId||receipt.targetOwner.workspaceId!==workspaceId||!Number.isSafeInteger(manifest.count)||manifest.count<0)fail();
  let count=0;for await(const key of store.objectIdEntries(prefix+'origin:'+manifest.id+':',{signal})){void key;count++;}if(count!==manifest.count)fail();
 }
 if(receiptId&&!await store.object('record-owner-drafts:'+receiptId))fail();
 for await(const row of store.db.rows('SELECT slot FROM state WHERE slot LIKE $1 ORDER BY slot',['record-owner-transfer:%'],{batchSize:32})){
  const receipt=await readRecordOwnerTransfer(store,row.slot.slice('record-owner-transfer:'.length));
  if(receipt.targetOwner.workspaceId===workspaceId&&receipt.phase==='complete'&&serialize(await store.object('record-owner-drafts:'+receipt.id))!==serialize(receipt.progress.drafts))fail();
 }
 for await(const id of store.objectIdEntries(prefix+'original:',{signal})){
  const value=await store.object(id);if(value?.version!==1||typeof value.raw!=='string'||id!==originalKey(digest(value.raw)))fail();let draft;try{draft=JSON.parse(value.raw);}catch{fail();}
  const receipt=await readRecordOwnerTransfer(store,value.transferId);if(!receipt||receipt.fingerprint!==value.fingerprint||receipt.sourceOwner.workspaceId!==workspaceId||receipt.command.recordId!==value.recordId||draft.id!==value.id||draft.workspaceId!==value.workspaceId||!records(draft).includes(value.recordId))fail();
 }
 const review=new RecordDraftReview(store.workspace),edits=new RecordDraftEdits(store);
 for await(const id of store.objectIdEntries(prefix+'review:',{signal})){signal?.throwIfAborted();const wrapper=await store.object(id),plan=await recordOwnerDraftArchived(store,'review',id.slice((prefix+'review:').length));review.validate(plan);if(await ready(wrapper))await verifyRecordDraftPlan(store,plan,{signal});}
 for await(const id of store.objectIdEntries(prefix+'edit:',{signal})){signal?.throwIfAborted();const wrapper=await store.object(id),node=await edits.node(id.slice((prefix+'edit:').length));if(await ready(wrapper))await verifyRecordDraftEdit(store,node,{signal});}
 for await(const id of store.objectIdEntries(prefix+'head:',{signal})){const wrapper=await store.object(id),head=await recordOwnerDraftArchived(store,'head',id.slice((prefix+'head:').length));if(await ready(wrapper)){const node=await edits.node(head.revision);if(hash(node.owner)!==hash(head.owner))fail();}}
}
