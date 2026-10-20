import {workspaceReferenceNamespaceMatches} from './research-reference-namespace.js';
// Run histories are traversed as retained facts. Validation and source checks
// never assemble a second copy of the preparations, events and assessments.
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {emptyAttempt,validAttemptFact,attemptReferences,attemptFactSearchParts} from './web/attempt-model.js';
import {revisionText} from './web/revision-model.js';
import {ResearchMaterials} from './research-materials.js';
import {preparationHeader,validatePreparationDocument,preparationReferences,preparationSearchParts,preparationValueRevision,preparationDocument,preparationRowById} from './record-preparation-document.js';
import {RecordAttemptIndex} from './record-attempt-index.js';
export const attemptGroups=['preparations','events','assessments'];
export const attemptKind=group=>group==='preparations'?'preparation':group==='events'?'event':'assessment';
const invalid=()=>{throw new AppError('INVALID',[{field:'Preparation, events and assessments'}]);};
export async function attemptDocumentHeader(document,{signal}={}){
 const root=await document.reference(['attempt'],{signal});if(root===null)return undefined;
 if((await document.tree.propertyNames(root)).sort().join()!=='assessments,events,preparations,version'||(await document.field(['attempt','version'],{signal})).value!==1)invalid();
 return emptyAttempt();
}
export async function* attemptDocumentFacts(document,{signal,offsets}={}){
 if(!await document.reference(['attempt'],{signal}))return;
 for(const group of attemptGroups)for await(const item of document.items(['attempt',group],{offset:offsets?.[group]??0,signal})){
  signal?.throwIfAborted();yield {group,kind:attemptKind(group),index:item.index,reference:item.value,value:group==='preparations'?await preparationHeader(document,item.value,{signal}):await document.tree.read(item.value)};
 }
}
export async function validateAttemptDocument(document,{signal,draft=false}={}){
 const header=await attemptDocumentHeader(document,{signal});if(!header)return undefined;
 // History collections continue through indexed appends and counted reader
 // windows. Each fact keeps its own semantic and nested-collection policies.
 const base=document.attemptAppendBase?.()??null,indexed=base?new RecordAttemptIndex(document,base):null;
 for(const group of attemptGroups){
  const count=await document.tree.arrayLength(document.root,['attempt',group]);if(count<(base?.[group]??0))invalid();
 }
 return withScratch(async identities=>{
  // The document owns this proof: only tail appends preserve it. The saved
  // prefix has already passed admission; identities and corrections there
  // come from its authenticated index, while new facts use scratch storage.
  const identity=async id=>{
   const fresh=await identities.get('id:'+id);if(fresh)return fresh;
   const row=await indexed?.fact(id);if(!row)return null;
   const reference=await document.reference(['attempt',row.group,String(row.position)],{signal});
   return {group:row.group,index:row.position,reference,
    preparationId:(await document.tree.selected(reference,['preparationId'])).value,
    criterionId:(await document.tree.selected(reference,['criterionId'])).value};
  };
  for await(const {group,kind,index,reference,value} of attemptDocumentFacts(document,{signal,offsets:base})){
   const preparations=[];
   if(!draft&&kind!=='preparation'&&value?.preparationId){
    const prior=await identity(value.preparationId);if(prior?.group==='preparations'){const criteria=[];if(kind==='assessment'&&(await identities.has('nested:'+value.preparationId+':criteria:'+value.criterionId)||await indexed?.nested(value.preparationId,'criteria',value.criterionId)||indexed&&base.version<3&&await preparationRowById(document,prior.reference,'criteria',value.criterionId,{signal})))criteria.push({id:value.criterionId});preparations.push({id:value.preparationId,criteria});}
   }
   if(kind==='preparation')await validatePreparationDocument(document,reference,{draft,signal,identities,prefix:'nested:'+value.id+':'});
   if(!(kind==='preparation'||validAttemptFact(kind,value,{draft,preparations}))||await indexed?.fact(value.id)||!await identities.add('id:'+value.id,{group,reference,index,preparationId:value.preparationId,criterionId:value.criterionId}))invalid();
   if(!draft){
    if(value.supersedes){
     const prior=await identity(value.supersedes);
     if(!prior||prior.group!==group||prior.index>=index||await indexed?.correction(value.supersedes)||!await identities.add('replaced:'+value.supersedes))invalid();
     if(kind==='assessment'&&(prior.preparationId!==value.preparationId||prior.criterionId!==value.criterionId))invalid();
    }else if(kind==='preparation'&&index)invalid();
   }
  }
  return header;
 },{signal});
}
export async function* attemptDocumentReferences(document,options={}){
 for await(const {group,value,reference} of attemptDocumentFacts(document,options)){if(group==='preparations')yield* preparationReferences(document,reference,options);else yield* attemptReferences({...emptyAttempt(),[group]:[value]});}
}
export async function* attemptDocumentSearchParts(document,options={}){
 let count=0;
 for await(const {kind,value,reference} of attemptDocumentFacts(document,options)){count++;if(kind==='preparation')yield* preparationSearchParts(document,reference,options);else yield* attemptFactSearchParts(kind,value);}
 for await(const ref of attemptDocumentReferences(document,options))yield ref.label;
 if(!count)yield '';
}
export async function attemptDocumentReadiness(document,{signal,offset=0,limit=20}={}){
 if(!Number.isSafeInteger(offset)||offset<0)throw new AppError('INVALID');
 const empty={items:[],offset:0,total:0,next:null};if(!await document.reference(['attempt'],{signal}))return empty;
 const count=await document.tree.arrayLength(document.root,['attempt','preparations']);if(!count)return empty;
 const reference=await document.reference(['attempt','preparations',String(count-1)],{signal}),preparation=await preparationHeader(document,reference,{signal});
 return withScratch(async facts=>{
  for await(const item of document.items(['attempt','assessments'],{signal})){
   const supersedes=(await document.tree.selected(item.value,['supersedes'])).value;if(supersedes)await facts.add('replaced:'+supersedes);
  }
  for await(const item of document.items(['attempt','assessments'],{signal})){
   const a=await document.tree.read(item.value);
   if(a.preparationId===preparation.id&&['met','not-met'].includes(a.outcome)&&!await facts.has('replaced:'+a.id))await facts.add('resolved:'+a.criterionId);
  }
  const items=[];let total=0;for await(const row of preparationDocument(document,reference).items(['criteria'],{signal})){
   const id=(await document.tree.selected(row.value,['id'])).value;if(await facts.has('resolved:'+id))continue;
   if(total>=offset&&items.length<limit)items.push({id,label:(await document.tree.selected(row.value,['label'])).value});total++;
  }
  return {items,offset,total,next:offset+items.length<total?offset+items.length:null};
 },{signal});
}
export async function validateAttemptDocumentChange(workspace,workspaceId,previous,document,recordId,{signal,validated=false}={}){
 const exists=await document.reference(['attempt'],{signal}),prior=previous?await previous.reference(['attempt'],{signal}):null;
 if(!exists){if(prior)throw new AppError('ATTEMPT_IMMUTABLE');return;}
 if(!validated)await validateAttemptDocument(document,{signal});
 const materials=new ResearchMaterials(workspace);
 const base=document.attemptAppendBase?.()??null,append=!!prior&&base?.source===prior;
 await withScratch(async checked=>{
  for(const group of attemptGroups){
   const before=prior?await previous.tree.arrayLength(previous.root,['attempt',group]):0,after=await document.tree.arrayLength(document.root,['attempt',group]);
   if(before>after)throw new AppError('ATTEMPT_IMMUTABLE');
   // Skip comparison only against the exact prefix from which this document
   // was appended. A different saved base, import or checkpoint still walks
   // every fact and applies the original immutable-history checks.
   const offset=append&&base[group]===before?before:0;
   for await(const item of document.items(['attempt',group],{offset,signal})){
    if(item.index<before){
     const old=await previous.reference(['attempt',group,String(item.index)],{signal});
     if(old!==item.value&&await preparationValueRevision(previous,old,{signal})!==await preparationValueRevision(document,item.value,{signal}))throw new AppError('ATTEMPT_IMMUTABLE');
    }
    const refs=group==='preparations'?preparationReferences(document,item.value,{signal}):attemptReferences({...emptyAttempt(),[group]:[await document.tree.read(item.value)]});
    for await(const ref of refs){
     if(!ref.workspaceId||!await workspaceReferenceNamespaceMatches(workspace,ref)||ref.kind==='record'&&ref.id===recordId)throw new AppError('ATTEMPT_REFERENCE');
     if(item.index>=before&&await checked.add(revisionText(ref)))await materials.checkReference(ref);
    }
   }
  }
 },{signal});
}
