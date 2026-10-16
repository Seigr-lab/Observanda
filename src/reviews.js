import {assertProjectReviewPacket} from './project-review-origin.js';
import {requestValue,responseValue,validateReviewPacket} from './review-contract.js';
import {randomUUID} from 'node:crypto';
import {ReviewIdentity,reviewHash,validateContact} from './security/review-exchange.js';
import {ReviewRecords,validReviewRecords} from './review-records.js';
import {ReviewScopeIndex} from './review-scope-index.js';
import {writeReviewSummary,readReviewSummary,reviewPage} from './review-summaries.js';
import {exact,uuid,text,requireValue,unique} from './modules/validation.js';
const root='.observanda/reviews/';
export const reviewReadOperations=Object.freeze(['plan','identity','list','read','export']);
export const reviewOperations=Object.freeze([...reviewReadOperations,'contact','untrust','create','import','respond']);
export {reviewDecisions} from './review-contract.js';
export class Reviews{
 constructor(workspace,device){this.workspace=workspace;this.identity=device?new ReviewIdentity(device):null;this.records=new ReviewRecords(workspace);}
 async index(){const raw=await this.workspace.readMetadata(root+'index.json',2000000);if(!raw)return {contacts:[],ids:[]};const v=JSON.parse(raw);requireValue(exact(v,['contacts','ids'])&&Array.isArray(v.contacts)&&v.contacts.length<=200&&v.contacts.every(c=>exact(c,['name','contact','active'])&&typeof c.active==='boolean'&&text(c.name,160,true)&&validateContact(c.contact))&&Array.isArray(v.ids)&&v.ids.length<=500&&v.ids.every(uuid)&&unique(v.ids),'Review index');return v;}
 async writeIndex(v,summary=null){
  if(summary)await this.workspace.catalogue(store=>new ReviewScopeIndex(store).append(v,summary,id=>readReviewSummary(this.workspace,id,key=>this.packet(key))));
  await this.workspace.writeMetadata(root+'index.json',JSON.stringify(v));
 }
 async packet(id){requireValue(uuid(id),'Review identity');const raw=await this.workspace.readMetadata(root+id+'.json',1800000);requireValue(!!raw,'Review unavailable');const packet=validateReviewPacket(JSON.parse(raw));await assertProjectReviewPacket(this.workspace,packet);return packet;}
 async writePacket(p){validateReviewPacket(p);await assertProjectReviewPacket(this.workspace,p);await this.workspace.writeMetadata(root+p.request.value.id+'.json',JSON.stringify(p));return writeReviewSummary(this.workspace,p);}
 async run(operation,data){
  requireValue(reviewOperations.includes(operation),'Review operation');
  const execute=()=>this.runValue(operation,data);
  return reviewReadOperations.includes(operation)?this.workspace.catalogue(execute):this.workspace.withLock(execute);
 }
 async runValue(operation,data){
  const {metadata}=await this.workspace.outline();requireValue(data.workspaceId===metadata.id,'Workspace changed');const index=await this.index();
  if(operation==='plan')return this.records.plan(metadata.id,data.scope);
  if(operation==='identity')return {contact:await this.identity.contact()};
  if(operation==='contact'){validateContact(data.contact);requireValue(text(data.name,160,true)&&data.verified===true,'Verify the contact fingerprint through another channel');const fingerprint=reviewHash(data.contact);requireValue(fingerprint!==reviewHash(await this.identity.contact()),'Choose another reviewer');const existing=index.contacts.find(c=>reviewHash(c.contact)===fingerprint);if(existing){existing.name=data.name;existing.active=true;}else{requireValue(index.contacts.length<200,'Contact limit');index.contacts.push({name:data.name,contact:data.contact,active:true});}await this.writeIndex(index);return {saved:true};}
  if(operation==='untrust'){const c=index.contacts.find(c=>reviewHash(c.contact)===data.fingerprint);requireValue(!!c,'Contact unavailable');c.active=false;await this.writeIndex(index);return {saved:true};}
  if(operation==='list')return reviewPage(this.workspace,index,data,id=>this.packet(id),this.records);
  if(operation==='create'){
   requireValue(uuid(data.id)&&validReviewRecords(data.records)&&text(data.message,4000),'Choose 1 to 50 saved records per request');const contact=index.contacts.find(c=>c.active&&reviewHash(c.contact)===data.recipient);requireValue(!!contact,'Verify the reviewer contact first');
   if(index.ids.includes(data.id)){const p=await this.packet(data.id);requireValue(p.direction==='outgoing'&&p.request.value.recipient===data.recipient&&p.request.value.message===data.message&&JSON.stringify(p.request.value.records.map(({id,revision})=>({id,revision})))===JSON.stringify(data.records),'Request identity already used');return {file:await this.identity.seal(p.request,contact.contact)};}
   if(data.scope){const plan=await this.records.plan(metadata.id,data.scope);requireValue(JSON.stringify(plan.records.map(({id,revision})=>({id,revision})))===JSON.stringify(data.records),'The selection changed. Preview the selection again.');}
   const records=await this.records.load(metadata.id,data.records);
   const sender=await this.identity.contact(),request=await this.identity.sign({kind:'request',id:data.id,workspaceId:metadata.id,createdAt:new Date().toISOString(),sender,recipient:data.recipient,message:data.message,records}),file=await this.identity.seal(request,contact.contact);requireValue(index.ids.length<500,'Review request limit');const summary=await this.writePacket({direction:'outgoing',request,response:null});index.ids.push(data.id);await this.writeIndex(index,summary);return {file};
  }
  if(operation==='import'){
   const signed=await this.identity.open(data.file),v=signed.value;requireValue(index.contacts.some(c=>c.active&&reviewHash(c.contact)===reviewHash(v.sender)),'Verify the sender contact before importing a review');
   if(v.kind==='request'){
    requestValue(signed);requireValue(v.recipient===reviewHash(await this.identity.contact()),'Request recipient');if(index.ids.includes(v.id)){const p=await this.packet(v.id);requireValue(reviewHash(p.request)===reviewHash(signed)&&p.direction==='incoming','Request identity already used');return {id:v.id,replayed:true};}
    requireValue(index.ids.length<500,'Review request limit');const summary=await this.writePacket({direction:'incoming',request:signed,response:null});index.ids.push(v.id);await this.writeIndex(index,summary);return {id:v.id};
   }
   requireValue(uuid(v.requestId)&&index.ids.includes(v.requestId),'No matching outgoing request');const p=await this.packet(v.requestId);requireValue(p.direction==='outgoing','Review direction');responseValue(signed,p.request);if(p.response){requireValue(reviewHash(p.response)===reviewHash(signed),'A different response is already retained');return {id:v.requestId,replayed:true};}p.response=signed;await this.writePacket(p);return {id:v.requestId};
  }
  requireValue(uuid(data.id)&&index.ids.includes(data.id),'Review unavailable');const p=await this.packet(data.id);
  if(operation==='read')return {packet:p};
  if(operation==='respond'){
   requireValue(index.contacts.some(c=>c.active&&reviewHash(c.contact)===reviewHash(p.request.value.sender)),'Verify the request sender before responding');
   requireValue(p.direction==='incoming','Only received requests can be reviewed');if(p.response){requireValue(reviewHash(p.response.value.decisions)===reviewHash(data.decisions),'This review already has a different signed response');return {file:await this.identity.seal(p.response,p.request.value.sender),replayed:true};}const sender=await this.identity.contact();requireValue(p.request.value.recipient===reviewHash(sender),'Only the invited reviewer can sign');
   const response=await this.identity.sign({kind:'response',id:randomUUID(),requestId:data.id,requestHash:reviewHash(p.request),createdAt:new Date().toISOString(),sender,recipient:reviewHash(p.request.value.sender),decisions:data.decisions});responseValue(response,p.request);const file=await this.identity.seal(response,p.request.value.sender);p.response=response;await this.writePacket(p);return {file};
  }
  if(operation==='export'){requireValue(index.contacts.some(c=>c.active&&reviewHash(c.contact)===(p.direction==='incoming'?reviewHash(p.request.value.sender):p.request.value.recipient)),'Verify the recipient before exporting');const signed=p.direction==='incoming'?p.response:p.request;requireValue(!!signed,'Sign a response first');const recipient=p.direction==='incoming'?p.request.value.sender:index.contacts.find(c=>reviewHash(c.contact)===p.request.value.recipient)?.contact;requireValue(!!recipient,'Verified recipient unavailable');return {file:await this.identity.seal(signed,recipient)};}
  throw Error('Unknown review operation');
 }
}
