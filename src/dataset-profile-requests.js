import {AppError} from './errors.js';
import {exact} from './modules/validation.js';
import {withScratch} from './scratch-work.js';
import {ResearchMaterials} from './research-materials.js';
import {researchId} from './web/research-reference.js';
import {materialReference,materialReferenceKey,validMaterialReference} from './web/material-reference.js';
import {revisionText} from './web/revision-model.js';
import {prepareProfileRevision,readDatasetProfile,profileExpectedFields,openProfileTemplate,profileList} from './dataset-interpretation-profile.js';
import {compareProfileColumns,profileColumnIdentity} from './dataset-profile-matching.js';
import {reviewProfileSource,withBatchProfile} from './dataset-profile-review.js';
import {retainRuleFileLocked} from './dataset-profile-rule-file.js';

const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const changed=()=>{throw new AppError('MATERIAL_CHANGED');};
const different=(left,right)=>revisionText(left)!==revisionText(right);

export async function withProfileAccess(materials,{recordId,sourceAccess,check=async()=>{},signal,write=false},consume){
 if(!researchId(recordId))invalid();
 return materials.workspace.withCatalogueConnections(async()=>{
  const cache=new Set();let access;
  const verify=async()=>{
   signal?.throwIfAborted();await check();await access?.verify();await materials.assertOwner(recordId,{write});
  };
  const source=async ref=>{
   if(!validMaterialReference(ref))invalid();
   const key=materialReferenceKey(ref);
   if(cache.has(key)){signal?.throwIfAborted();return;}
   await verify();
   const address=await materials.externalReference(ref);
   if(sourceAccess){
    access??=await sourceAccess(materials.workspace,{signal});
    const scoped=address??materialReference({...ref,workspaceId:ref.workspaceId??access.workspaceId});
    await access.use(scoped,async(storage,canonical)=>{
     if(canonical.kind!==ref.kind||canonical.id!==ref.id||canonical.revision!==ref.revision)changed();
     await new ResearchMaterials(storage).checkReference(canonical,{signal});
    });
   }else{
    if(address)throw new AppError('ACCESS_LOCKED');
    await materials.checkReference(ref,{signal});
   }
   if(cache.size>=256)cache.delete(cache.values().next().value);
   cache.add(key);
  };
  try{await verify();const result=await consume({signal,check:source,verify});await verify();return result;}
  finally{await access?.close();}
 });
}

function snapshot(value){
 if(value===undefined)return null;
 const raw=typeof value==='string'?value:revisionText(value);
 return {text:raw.slice(0,240),truncated:raw.length>240};
}
async function revisionDifferences(proposal,{offset,limit,signal}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>32)invalid();
 const {previous,source}=proposal,page={items:[],offset,total:0,next:null};
 const append=(change,details)=>{const index=page.total++;if(index>=offset&&page.items.length<limit)page.items.push({...change,...details()});};
 if(!previous)return page;
 const oldRules=new Map(previous.rules.map(rule=>[rule.index,rule]));
 const rules=proposal.rules,newRules=new Map(rules.map(rule=>[rule.index,rule]));
 if(previous.doc.title!==proposal.proposal.title)append({kind:'title'},()=>({before:snapshot(previous.doc.title),after:snapshot(proposal.proposal.title)}));
 if(!different(previous.template,proposal.proposal.inputs[0])){
  for(const index of new Set([...oldRules.keys(),...newRules.keys()])){
   const before=oldRules.get(index),after=newRules.get(index);
   if(different(before,after))append({kind:'rule',index},()=>({before:snapshot(before),after:snapshot(after)}));
  }
 }else{
  append({kind:'template'},()=>({before:snapshot(previous.template),after:snapshot(proposal.proposal.inputs[0])}));
  await withScratch(async work=>{
   const matches=await compareProfileColumns(work,{template:profileExpectedFields(previous.source,previous.rules),source:profileExpectedFields(source,rules),
    expectedMapping:previous.source.mapping,actualMapping:source.mapping,signal});
   if(!matches.sameMapping)append({kind:'mapping'},()=>({before:snapshot(previous.source.mapping),after:snapshot(source.mapping)}));
   let index=0;
   for await(const after of source.fields()){
    const match=await matches.sourceAt(index);
    if(match.profileIndex===null)append({kind:'column',index,status:match.status},()=>({before:null,after:snapshot(after.name)}));
    else{
     const before=await previous.source.column(match.profileIndex);
     for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(different(before[key],after[key])){
      append({kind:'field',index,key},()=>({before:snapshot(before[key]),after:snapshot(after[key])}));
     }
     const priorRule=oldRules.get(match.profileIndex),nextRule=newRules.get(index);
     if(different(priorRule,nextRule))append({kind:'rule',index},()=>({before:snapshot(priorRule),after:snapshot(nextRule)}));
     if(match.status==='reordered'||match.status==='renamed')append({kind:'column',index,status:match.status},()=>({before:snapshot(before.name),after:snapshot(after.name)}));
    }
    index++;
   }
   for(let index=0;index<matches.expectedCount;index++){
    const missing=await matches.missingAt(index);
    if(missing)append({kind:'column',index,status:missing.status},()=>({before:snapshot(missing.identity),after:null}));
   }
  },{signal});
 }
 page.next=offset+page.items.length<page.total?offset+page.items.length:null;
 return page;
}

export async function interpretationProfileRequest(materials,operation,data,options={}){
 if(operation==='dataset-profile-list'){
  if(!exact(data,['recordId','query','after']))invalid();
  return withProfileAccess(materials,{...options,recordId:data.recordId},grants=>profileList(materials,data,grants));
 }
 if(operation==='dataset-profile-template'){
  if(!exact(data,['recordId','ref','offset','limit'])||!Number.isSafeInteger(data.offset)||data.offset<0||
   !Number.isSafeInteger(data.limit)||data.limit<1||data.limit>32)invalid();
  return withProfileAccess(materials,{...options,recordId:data.recordId},async grants=>{
   const source=await openProfileTemplate(materials,data.ref,grants),items=[];
   if(data.offset>source.width)invalid();
   const columns=await materials.retainedSchemaPage(source.doc,{offset:data.offset,limit:data.limit});
   let index=0;
   for await(const field of source.identities()){
    if(index>=data.offset){
     const column=columns.items[index-data.offset];
     if(!column)break;
     items.push({index,identity:profileColumnIdentity(field,index),name:column.name,unit:column.unit,representation:column.representation,radix:column.radix});
    }
    if(++index>=data.offset+data.limit)break;
   }
   return {items,total:source.width,next:columns.next};
  });
 }
 if(operation==='dataset-schema-group-review'||operation==='dataset-schema-group-columns'){
  if(!exact(data,['recordId','command','offset','limit']))invalid();
  const {reviewSchemaGroup}=await import('./dataset-schema-group.js');
  return withProfileAccess(materials,{...options,recordId:data.recordId},grants=>reviewSchemaGroup(materials,data.command,{
   ...grants,offset:data.offset,limit:data.limit,values:operation==='dataset-schema-group-review'}));
 }
 if(operation==='dataset-profile-read'){
  if(!exact(data,['recordId','ref']))invalid();
  return withProfileAccess(materials,{...options,recordId:data.recordId},async grants=>{
   const {doc,template,source,signature,rules}=await readDatasetProfile(materials,data.ref,grants);
   return {title:doc.title,id:doc.id,recordId:doc.recordId,template,width:source.width,signature,rules};
  });
 }
 if(operation==='dataset-profile-review-batch'){
  if(!exact(data,['recordId','profile','files'])||!Array.isArray(data.files)||!data.files.length||data.files.length>8||
   data.files.some(item=>!exact(item,['ref','details'])||!validMaterialReference(item.ref)||item.ref.kind!=='artifact'||typeof item.details!=='boolean'))invalid();
  return withProfileAccess(materials,{...options,recordId:data.recordId},async grants=>{
   const model=await readDatasetProfile(materials,data.profile,grants);
   return withBatchProfile(model,grants,async profile=>{
    const items=[];
    for(const file of data.files){
     try{
      const report=await reviewProfileSource(materials,profile,file.ref,{...grants,summaryOnly:!file.details});
      items.push({report});
     }catch(error){
      // Permission changes and damaged native state invalidate the whole
      // response; ordinary source-format problems affect only that file.
      if(!['MATERIAL_TABLE','MATERIAL_INVALID','MATERIAL_DATASET_LIMIT','DATASET_JOIN_KEY','DATASET_JOIN_LENGTH','DATASET_JOIN_DUPLICATE','DATASET_JOIN_MISSING','DATASET_PACKED_LENGTH'].includes(error.code))throw error;
      items.push({code:error.code});
     }
    }
    return {items};
   });
  });
 }
 if(['dataset-profile-revision','dataset-profile-save'].includes(operation)){
  if(!exact(data,operation==='dataset-profile-save'?['command','review']:['command','offset','limit']))invalid();
  return withProfileAccess(materials,{...options,recordId:data.command?.recordId,write:true},async grants=>{
   const saving=operation==='dataset-profile-save';
   const proposal=await prepareProfileRevision(materials,data.command,{...grants,replay:saving});
   if(operation==='dataset-profile-revision'){
    const changes=await revisionDifferences(proposal,{offset:data.offset,limit:data.limit,signal:options.signal});
    return {review:proposal.review,signature:proposal.signature,width:proposal.source.width,changes,previous:proposal.previous?.doc.title??null};
   }
   if(data.review!==proposal.review)changed();
   return materials.workspace.withLock(async()=>{
    await grants.verify();
    const head=await materials.current(proposal.proposal.id);
    if((head?.revision??null)!==proposal.proposal.expectedRevision){
     if(!head)changed();
     const accepted=await readDatasetProfile(materials,head,grants);
     if(accepted.doc.recordId!==proposal.proposal.recordId||accepted.doc.previous!==proposal.proposal.expectedRevision||
      accepted.doc.title!==proposal.proposal.title||accepted.doc.content.parameters!==proposal.proposal.parameters||
      different(accepted.template,proposal.proposal.inputs[0]))changed();
     return {ref:materialReference(head)};
    }
    const command=proposal.proposal;
    if(proposal.file){
     const file=await retainRuleFileLocked(materials,command,proposal.rules,proposal.file,grants);
     return {ref:await materials.analysisLocked({...command,inputs:[...command.inputs,file]})};
    }
    return {ref:await materials.analysisLocked(command)};
   });
  });
 }
 if(operation!=='dataset-profile-review'||!exact(data,['recordId','profile','artifact','page'])||
  !data.page||typeof data.page!=='object'||Array.isArray(data.page)||Object.keys(data.page).some(k=>!['columns','issues','examples'].includes(k)))invalid();
 return withProfileAccess(materials,{...options,recordId:data.recordId},async grants=>{
  const profile=await readDatasetProfile(materials,data.profile,grants);
  return reviewProfileSource(materials,profile,data.artifact,{...data.page,...grants});
 });
}
