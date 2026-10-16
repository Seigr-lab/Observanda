import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {summaryPage} from './summary-page.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {moduleDomainContext} from './module-domain-context.js';
import {moduleDomainOf} from './modules/domains.js';
import {exact,uuid} from './modules/validation.js';
export const researchReferenceTypes=['project','notebook','record'];
export const validModuleReference=ref=>exact(ref,['workspaceId','type','id'])&&uuid(ref.workspaceId)&&uuid(ref.id)&&(researchReferenceTypes.includes(ref.type)||moduleDomainOf(ref.type)!==null);
export async function moduleReferenceContext(store,types,consume){
 const domains=[...new Set(types.map(moduleDomainOf).filter(Boolean))];
 if(!domains.length)return consume(null);
 const current=await moduleDomainContext(store,consume,{domains,scoped:false});if(current)return current.value;
 const catalogue=new ModuleCatalogue(store),head=await catalogue.head((await store.snapshot()).metadata.id);
 return consume({head,member:id=>catalogue.member(head,id),members:options=>catalogue.members(head,options),view:member=>catalogue.view(head,member),search:member=>catalogue.search(head,member)});
}
export async function moduleReferenceSummary(store,snapshot,ref){
 if(ref.type==='record'){
  const member=await store.member(snapshot,ref.id);if(!member)throw new AppError('NOT_FOUND');
  for await(const value of store.queryDocuments([member],snapshot.metadata,{search:false,references:false,revisions:false}))return {title:value.title,openType:ref.type,openId:ref.id};
  throw new AppError('CATALOGUE_DAMAGED');
 }
 if(researchReferenceTypes.includes(ref.type)){
  const value=snapshot.metadata[ref.type==='project'?'projects':'notebooks'].find(item=>item.id===ref.id);if(!value)throw new AppError('NOT_FOUND');
  return {title:value.title,openType:ref.type,openId:ref.id};
 }
 return moduleReferenceContext(store,[ref.type],async context=>{
  let member;try{member=await context.member(ref.id);}catch(error){if(error.code!=='MODULE_REFERENCE')throw error;throw new AppError('NOT_FOUND');}if(!member||member.type&&member.type!==ref.type)throw new AppError('NOT_FOUND');
  const view=await context.view(member);if(view.type!==ref.type)throw new AppError('CATALOGUE_DAMAGED');
  return {title:view.title,openType:view.openType,openId:view.openId};
 });
}
const order=(a,b)=>{const x=a.title.toLocaleLowerCase('en'),y=b.title.toLocaleLowerCase('en');return x<y?-1:x>y?1:a.type<b.type?-1:a.type>b.type?1:a.id<b.id?-1:a.id>b.id?1:0;};
// A mixed research/module page retains only its bounded result and cursor edges.
// The selected owner's authenticated summary indexes supply labels, not bodies.
export async function moduleReferenceQuery(store,snapshot,command,{signal}={}){
 const {workspaceId,sourceId,types,query,cursor,limit}=command;
 if(!exact(command,['workspaceId','sourceId','types','query','cursor','limit'])||!uuid(workspaceId)||!uuid(sourceId)||!Array.isArray(types)||!types.length||types.length>40||new Set(types).size!==types.length||!types.every(type=>researchReferenceTypes.includes(type)||moduleDomainOf(type)!==null)||typeof query!=='string'||query.length>160||!Number.isSafeInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||cursor.length>8192))throw new AppError('INVALID');
 const researchRevision=await store.head(),signature=digest(JSON.stringify([workspaceId,sourceId,types,query,limit]));let anchor;
 try{anchor=cursor?store.decode('module-reference-page',workspaceId,Buffer.from(cursor,'base64url')):{signature,offset:0};}catch{throw new AppError('MODULE_QUERY_CURSOR');}
 if(!anchor||anchor.signature!==signature||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset>0&&(!uuid(anchor.after?.id)||typeof anchor.after.title!=='string'||!types.includes(anchor.after.type)))throw new AppError('MODULE_QUERY_CURSOR');
 const page=summaryPage({...anchor,limit,order,point:row=>({id:row.id,type:row.type,title:row.title})}),needle=query.trim().toLocaleLowerCase('en');
 const add=(type,id,title,openType=type,openId=id)=>page.add({id,type,title,reference:{workspaceId:sourceId,type,id},openType,openId});
 const revision=await moduleReferenceContext(store,types,async context=>{
  const revision=digest(JSON.stringify([researchRevision,context?.head.revision??null]));if(cursor&&anchor.revision!==revision)throw new AppError('MODULE_QUERY_CURSOR');
  if(context)for await(const member of context.members({signal})){
   signal?.throwIfAborted();if(member.type&&!types.includes(member.type))continue;
   const view=await context.view(member);if(!types.includes(view.type)||needle&&!(await context.search(member)).includes(needle))continue;
   add(view.type,view.id,view.title,view.openType,view.openId);
  }
  return revision;
 });
 // Domain reads restore the research schema before research summaries are read.
 for(const [type,collection] of [['project','projects'],['notebook','notebooks']])if(types.includes(type))for(const value of snapshot.metadata[collection]){signal?.throwIfAborted();if(!needle||value.title.toLocaleLowerCase('en').includes(needle))add(type,value.id,value.title);}
 if(types.includes('record')){
  const ids=new Set(snapshot.metadata.notebooks.map(book=>book.id)),members=store.searchMembers(snapshot,ids,query,{signal});
  for await(const value of store.queryDocuments(members,snapshot.metadata,{signal,search:false,matching:query,references:false,revisions:false})){signal?.throwIfAborted();add('record',value.id,value.title);}
 }
 let result;try{result=page.finish();}catch(error){if(error.code==='RECORD_QUERY_CURSOR')throw new AppError('MODULE_QUERY_CURSOR');throw error;}
 anchor={...anchor,revision};const encode=value=>store.encode('module-reference-page',workspaceId,value).toString('base64url'),next=anchor.offset+result.records.length;
 return {workspaceId,sourceId,revision,items:result.records,offset:anchor.offset,total:result.total,cursor:encode(anchor),nextCursor:next<result.total?encode({...anchor,offset:next,after:result.after}):null,previousCursor:anchor.offset?encode({...anchor,offset:Math.max(0,anchor.offset-limit),after:anchor.offset>limit?result.previousAfter:null}):null};
}
