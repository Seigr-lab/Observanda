// Authoring reads one fact and its exact preparation context. Preparation
// choices are summaries in independent windows, never a copy of run history.
import {AppError} from './errors.js';
import {emptyAttempt} from './web/attempt-model.js';
import {attemptValueField} from './web/record-attempt-value.js';
import {researchId} from './web/research-reference.js';
import {RecordAttemptIndex} from './record-attempt-index.js';
export const validAttemptContext=c=>!!attemptValueField(c.field)&&(c.prior===null||researchId(c.prior))&&(c.preparationId===null||researchId(c.preparationId))&&Number.isSafeInteger(c.offset)&&c.offset>=0;
export async function attemptFactPosition(document,group,id,{signal}={}){
 if(!id||!await document.reference(['attempt'],{signal}))return -1;
 const index=await RecordAttemptIndex.open(document,{signal});if(index)return (await index.fact(id,group))?.position??-1;
 for await(const item of document.items(['attempt',group],{signal}))if((await document.tree.selected(item.value,['id'])).value===id)return item.index;
 return -1;
}
export async function attemptSuccessor(document,group,id,{signal}={}){
 let latest=id;if(!id)return null;
 const index=await RecordAttemptIndex.open(document,{signal});if(index){let position=(await index.fact(id,group))?.position??-1,correction;while((correction=await index.correction(latest))){signal?.throwIfAborted();if(correction.group!==group||correction.position<=position)throw new AppError('CATALOGUE_DAMAGED');position=correction.position;latest=correction.id;}return latest;}
 for await(const item of document.items(['attempt',group],{signal}))if((await document.tree.selected(item.value,['supersedes'])).value===latest)latest=(await document.tree.selected(item.value,['id'])).value;
 return latest;
}
export async function attemptValueContext(document,field,{prior=null,preparationId=null,offset=0,signal,selected=null}={}){
 const fact=attemptValueField(field);if(!fact)throw new AppError('INVALID');
 const attempt=emptyAttempt(),positions={},totals={preparations:0,events:0,assessments:0},page={offset:0,total:0,next:null,items:[]};
 const definition={kind:'attempt',factKind:fact.kind,attempt,methods:[],positions,totals,preparations:page,latestPreparationId:null,correctionId:null};
 if(!await document.reference(['attempt'],{signal})){if(prior||preparationId)throw new AppError('MISSING');return definition;}
 for(const group of Object.keys(totals))totals[group]=await document.tree.arrayLength(document.root,['attempt',group]);
 const read=async(group,index)=>(await document.field(['attempt',group,String(index)],{signal})).value;
 const add=async(group,index)=>{if(index<0)return null;const value=await read(group,index);if(!attempt[group].some(p=>p.id===value.id))attempt[group].push(value);if(group==='preparations')positions[value.id]=index;return value;};
 if(selected){attempt[fact.group].push(selected);if(fact.group==='preparations')positions[selected.id]=await attemptFactPosition(document,fact.group,selected.id,{signal});}
 prior??=selected?.supersedes??null;preparationId??=selected?.preparationId??null;
 if(prior){
  const position=await attemptFactPosition(document,fact.group,prior,{signal});if(position<0)throw new AppError('MISSING');
  const previous=await add(fact.group,position);preparationId??=previous.preparationId??null;
  definition.correctionId=await attemptSuccessor(document,fact.group,prior,{signal});
  if(definition.correctionId!==prior)await add(fact.group,await attemptFactPosition(document,fact.group,definition.correctionId,{signal}));
 }
 if(totals.preparations){
  const last=totals.preparations-1;definition.latestPreparationId=(await document.field(['attempt','preparations',String(last),'id'],{signal})).value;
  if(fact.kind==='preparation'||!preparationId){
   let index=last;
   if(fact.kind==='assessment'){
    const retained=await RecordAttemptIndex.open(document,{signal});
    if(retained)index=(await retained.latestCriteria())?.position??-1;
    else while(index>=0&&await document.tree.arrayLength(await document.reference(['attempt','preparations',String(index)],{signal}),['criteria'])===0)index--;
   }
   if(index>=0)await add('preparations',index);
  }
 }
 if(preparationId){const index=await attemptFactPosition(document,'preparations',preparationId,{signal});if(index<0)throw new AppError('MISSING');await add('preparations',index);}
 // Corrected facts can refer to a different preparation from their predecessor.
 for(const item of [...attempt.events,...attempt.assessments])if(item.preparationId&&!attempt.preparations.some(p=>p.id===item.preparationId))await add('preparations',await attemptFactPosition(document,'preparations',item.preparationId,{signal}));
 attempt.preparations.sort((a,b)=>positions[a.id]-positions[b.id]);
 page.total=totals.preparations;page.offset=Math.min(offset,Math.max(0,page.total-1));page.next=page.offset+4<page.total?page.offset+4:null;
 for await(const item of document.items(['attempt','preparations'],{offset:page.offset,limit:4,signal})){
  const prop=async key=>(await document.tree.selected(item.value,[key])).value;
  page.items.push({id:await prop('id'),position:item.index,applicability:await prop('applicability'),hasCriteria:await document.tree.arrayLength(item.value,['criteria'])>0});
 }
 return definition;
}
