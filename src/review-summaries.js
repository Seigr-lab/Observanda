import {reviewScopeNamespace} from './project-review-origin.js';
import {ReviewScopeIndex,reviewMembership} from './review-scope-index.js';
import {reviewHash} from './security/review-exchange.js';
import {AppError} from './errors.js';
import {uuid,exact,instant,text,unique} from './modules/validation.js';

export const REVIEW_PAGE_SIZE=5;
const root='.observanda/reviews/summaries/',hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function reviewSummary(packet){
 const q=packet.request.value,r=packet.response?.value;
 return {id:q.id,workspaceId:q.workspaceId,direction:packet.direction,createdAt:q.createdAt,
  contact:packet.direction==='outgoing'?q.recipient:reviewHash(q.sender),
  records:q.records.map(({id,revision,record})=>({id,revision,title:record.title})),
  decisions:r?.decisions??[],signedAt:r?.createdAt??null,signer:r?reviewHash(r.sender):null};
}
function validate(value,id){
 if(!exact(value,['id','workspaceId','direction','createdAt','contact','records','decisions','signedAt','signer'])||value.id!==id||!uuid(value.workspaceId)||!['incoming','outgoing'].includes(value.direction)||!instant(value.createdAt)||!hash(value.contact)||
  !Array.isArray(value.records)||!value.records.length||value.records.length>50||!unique(value.records.map(r=>r?.id))||!value.records.every(r=>exact(r,['id','revision','title'])&&uuid(r.id)&&hash(r.revision)&&text(r.title,1000))||
  !Array.isArray(value.decisions)||!unique(value.decisions.map(d=>d?.id))||!value.decisions.every(d=>exact(d,['id','revision','decision','comment'])&&value.records.some(r=>r.id===d.id&&r.revision===d.revision)&&['reviewed','witnessed','changes-requested','inconclusive'].includes(d.decision)&&text(d.comment,8000))||
  (value.decisions.length? !instant(value.signedAt)||!hash(value.signer):value.signedAt!==null||value.signer!==null))throw new AppError('CATALOGUE_DAMAGED');
 return value;
}
export async function writeReviewSummary(workspace,packet){const value=validate(reviewSummary(packet),packet.request.value.id);await workspace.writeMetadata(root+value.id+'.json',JSON.stringify(value));return value;}
export async function readReviewSummary(workspace,id,readPacket,{cache=true}={}){
 const raw=await workspace.readMetadata(root+id+'.json',1800000);
 if(raw){try{return validate(JSON.parse(raw),id);}catch{throw new AppError('CATALOGUE_DAMAGED');}}
 // Older packets are verified once, then keep an encrypted derived summary.
 // This runs under the existing review transaction, including backup/restore.
 const packet=await readPacket(id);if(cache)await writeReviewSummary(workspace,packet);return reviewSummary(packet);
}
export async function reviewPage(workspace,index,command,readPacket,records){
 const recordId=command.recordId??null,cursor=command.cursor??null,workspaceId=command.workspaceId,indexHash=reviewHash(index.ids);
 if(recordId!==null&&!uuid(recordId)||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
 return workspace.catalogue(async store=>{
  let offset=0;
  if(cursor!==null){
   let value;try{value=store.decode('review-page',workspaceId,Buffer.from(cursor,'base64url'));}catch{throw new AppError('INVALID');}
   if(!exact(value,['version','workspaceId','indexHash','recordId','offset'])||value.version!==1||value.workspaceId!==workspaceId||value.indexHash!==indexHash||value.recordId!==recordId||!Number.isSafeInteger(value.offset)||value.offset<0||value.offset%REVIEW_PAGE_SIZE)throw new AppError('CONFLICT');offset=value.offset;
  }
  const items=[],namespaces=new Map();let total=0;
  if(!recordId){
   total=index.ids.length;
   for(const id of index.ids.toReversed().slice(offset,offset+REVIEW_PAGE_SIZE))items.push(await readReviewSummary(workspace,id,readPacket,{cache:false}));
  }else{
   const selected=await new ReviewScopeIndex(store).page(index,workspaceId,recordId,offset,REVIEW_PAGE_SIZE,id=>readReviewSummary(workspace,id,readPacket,{cache:false}));
   total=selected.total;
   for(const pointer of selected.items){
    const value=await readReviewSummary(workspace,pointer.id,readPacket,{cache:false});
    // A foreign workspace cannot witness a local record with a matching UUID.
    const namespaceId=await reviewScopeNamespace(store,value);namespaces.set(value.id,namespaceId);
    if(namespaceId!==workspaceId||!value.records.some(r=>r.id===recordId)||reviewMembership(value)!==pointer.revision)throw new AppError('CATALOGUE_DAMAGED');
    items.push({...value,records:value.records.filter(r=>r.id===recordId),decisions:value.decisions.filter(d=>d.id===recordId)});
   }
  }
  if(offset>0&&offset>=total)throw new AppError('CONFLICT');
  const local=new Set();for(const item of items)if((namespaces.has(item.id)?namespaces.get(item.id):await reviewScopeNamespace(store,item))===workspaceId)local.add(item.id);
  const current=await records.current(workspaceId,items.filter(i=>local.has(i.id)).flatMap(i=>i.records.map(r=>r.id)));
  for(const item of items){
   item.contact=index.contacts.find(c=>reviewHash(c.contact)===item.contact)?.name??null;
   item.records=item.records.map(r=>({...r,current:local.has(item.id)&&current.get(r.id)?current.get(r.id)===r.revision:null}));
  }
  const token=position=>store.encode('review-page',workspaceId,{version:1,workspaceId,indexHash,recordId,offset:position}).toString('base64url');
  return {contacts:index.contacts.map(c=>({name:c.name,fingerprint:reviewHash(c.contact),active:c.active})),items,total,offset,
   previousCursor:offset?token(Math.max(0,offset-REVIEW_PAGE_SIZE)):null,nextCursor:offset+items.length<total?token(offset+items.length):null};
 });
}
