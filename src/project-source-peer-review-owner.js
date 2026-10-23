import {readReviewStage} from './review-staging.js';
import {projectSourceOwnerOrderChanges} from './project-source-owner-order.js';
import {Reviews} from './reviews.js';
import {readReviewSummary,reviewSummary} from './review-summaries.js';
import {projectPeerReviewOwnership} from './project-peer-review-ownership.js';
import {ProjectSourceOwner} from './project-source-owner.js';
import {projectSourceRecordOwner} from './project-source-record-owner.js';
import {reviewHash} from './security/review-exchange.js';
import {serialize} from './storage-format.js';
import {AppError} from './errors.js';
export const projectReviewIndexKey='metadata:.observanda/reviews/index.json';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
function reader(store,inventory,record,{signal}={}){
 const workspace=store.workspace,reviews=new Reviews(workspace),declarations=new ProjectSourceOwner(store,inventory.namespaceId),facts=new Map();
 const scopes={...inventory,record:async id=>{const fact=await record(id);return {...fact,selected:fact.projectId===inventory.projectId};},review:(id,summary)=>declarations.resolve('review',id,summary)};
 return {
  retired:id=>declarations.retired('review',id),
  async summary(id){return workspace.inspectCatalogue(store,()=>readReviewSummary(workspace,id,key=>reviews.packet(key),{cache:false}));},
  async owner(id){
   if(facts.has(id))return facts.get(id);return workspace.inspectCatalogue(store,async()=>{
    signal?.throwIfAborted();const retired=await this.retired(id);if(retired)return {kind:'projects',projectIds:[retired.owner.projectId]};const packet=await reviews.packet(id),summary=await this.summary(id);if(reviewHash(reviewSummary(packet))!==reviewHash(summary))damaged();
    const fact=await projectPeerReviewOwnership(scopes,summary,{signal}),result={kind:'projects',projectIds:fact.projectIds};if(facts.size>=128)facts.delete(facts.keys().next().value);facts.set(id,result);return result;
   });
  },
  async index(){return workspace.inspectCatalogue(store,async()=>{const value=await reviews.index();if(new Set(value.contacts.map(item=>reviewHash(item.contact))).size!==value.contacts.length)damaged();return value;});}
 };
}
export function projectSourcePeerReviewOwner(store,inventory,record,{signal}={}){
 const source=reader(store,inventory,record,{signal});
 return async id=>{
  const match=/^metadata:\.observanda\/reviews\/(?:summaries\/)?([a-f0-9-]{36})\.json$/.exec(id);if(match)return source.owner(match[1]);
  const part=/^metadata:\.observanda\/reviews\/parts\/([a-f0-9-]{36})\//.exec(id);if(!part)return null;
  return store.workspace.inspectCatalogue(store,async()=>{const raw=await store.workspace.readMetadata('.observanda/reviews/parts/'+part[1]+'/head.json',8192);if(raw===null){const stage=await readReviewStage(store.workspace,part[1]);if(!stage)damaged();if(stage.requestId!==null){const text=await store.workspace.readMetadata('.observanda/reviews/'+stage.requestId+'.json',1800000);if(text!==null){let packet;try{packet=JSON.parse(text);}catch{damaged();}if(packet?.parts===part[1])damaged();}}return {kind:'derived'};}let head;try{head=JSON.parse(raw);}catch{damaged();}const packet=await new Reviews(store.workspace).packet(head.requestId);if(packet.parts!==part[1]||head.selectionHash!==reviewHash(packet.request)||head.direction!==packet.direction)damaged();return source.owner(head.requestId);});
 };
}
// The legacy review index is capped at 500 requests and 200 contacts. Request
// additions do not require re-reading all signed packet bodies. A changed trust
// decision matters only to projects whose retained requests use that contact.
export async function* projectSourceReviewIndexChanges(before,after,inventory,{signal}={}){
 const left=reader(before,inventory,projectSourceRecordOwner(before,inventory,{signal}),{signal}),right=reader(after,inventory,projectSourceRecordOwner(after,inventory,{signal}),{signal}),a=await left.index(),b=await right.index(),oldIds=new Set(a.ids),newIds=new Set(b.ids);
 for(const id of oldIds)if(!newIds.has(id))yield await left.owner(id);
 for(const id of newIds)if(!oldIds.has(id))yield await right.owner(id);
 const oldCommon=a.ids.filter(id=>newIds.has(id)),newCommon=b.ids.filter(id=>oldIds.has(id));
 if(serialize(oldCommon)!==serialize(newCommon)){
  const selected=async(source,ids)=>{const result=[];for(const id of ids){signal?.throwIfAborted();if((await source.owner(id)).projectIds.includes(inventory.projectId))result.push(id);}return result;};
  if(inventory.projectId===null){const values=async(source,ids)=>{const result=[];for(const id of ids)result.push({id,owner:await source.owner(id)});return result;};yield* projectSourceOwnerOrderChanges(await values(left,oldCommon),await values(right,newCommon));}
  else if(serialize(await selected(left,oldCommon))!==serialize(await selected(right,newCommon)))yield {kind:'project',projectId:inventory.projectId};
 }
 const oldContacts=new Map(a.contacts.map(item=>[reviewHash(item.contact),item])),newContacts=new Map(b.contacts.map(item=>[reviewHash(item.contact),item])),changed=new Set([...oldContacts.keys(),...newContacts.keys()].filter(id=>serialize(oldContacts.get(id)??null)!==serialize(newContacts.get(id)??null)));
 if(changed.size)for(const [source,index] of [[left,a],[right,b]])for(const id of index.ids){signal?.throwIfAborted();const retired=await source.retired(id);if(retired){if(inventory.projectId===null||inventory.projectId===retired.owner.projectId)yield await source.owner(id);continue;}const summary=await source.summary(id);if(changed.has(summary.contact))yield await source.owner(id);}
}
