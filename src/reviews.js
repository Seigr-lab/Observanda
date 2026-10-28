import {ReviewStaging} from './review-staging.js';
import {assertProjectReviewPacket} from './project-review-origin.js';
import {requestValue,responseValue,validateReviewPacket} from './review-contract.js';
import {ExchangeParts} from './collaboration/exchange-parts.js';
import {readExchange,writeExchange} from './collaboration/exchange-stream.js';
import {captureReviewFigures,hasReviewFigures,indexReviewFigurePart,verifyReviewFigures,readReviewFigure} from './review-figures.js';
import {requireReviewFigurePackages} from './catalogue-format.js';
import {randomUUID} from 'node:crypto';
import {ReviewIdentity,reviewHash,reviewText,reviewExchangeKeys,validateContact} from './security/review-exchange.js';
import {ReviewRecords,validReviewRecords} from './review-records.js';
import {ReviewScopeIndex} from './review-scope-index.js';
import {writeReviewSummary,readReviewSummary,reviewPage} from './review-summaries.js';
import {exact,uuid,text,requireValue,unique} from './modules/validation.js';
import {reviewOperations,reviewReadOperations} from './review-route-policy.js';
export {reviewOperations,reviewReadOperations} from './review-route-policy.js';
const root='.observanda/reviews/';
export {reviewDecisions} from './review-contract.js';
export class Reviews{
 constructor(workspace,device){this.workspace=workspace;this.identity=device?new ReviewIdentity(device):null;this.records=new ReviewRecords(workspace);this.stages=new ReviewStaging(workspace);}
 async index(){const raw=await this.workspace.readMetadata(root+'index.json',2000000);if(!raw)return {contacts:[],ids:[]};const v=JSON.parse(raw);requireValue(exact(v,['contacts','ids'])&&Array.isArray(v.contacts)&&v.contacts.length<=200&&v.contacts.every(c=>exact(c,['name','contact','active'])&&typeof c.active==='boolean'&&text(c.name,160,true)&&validateContact(c.contact))&&Array.isArray(v.ids)&&v.ids.length<=500&&v.ids.every(uuid)&&unique(v.ids),'Review index');return v;}
 async writeIndex(v,summary=null){
  if(summary)await this.workspace.catalogue(store=>new ReviewScopeIndex(store).append(v,summary,id=>readReviewSummary(this.workspace,id,key=>this.packet(key))));
  await this.workspace.writeMetadata(root+'index.json',JSON.stringify(v));
 }
 async packet(id){requireValue(uuid(id),'Review identity');const raw=await this.workspace.readMetadata(root+id+'.json',1800000);requireValue(!!raw,'Review unavailable');const packet=validateReviewPacket(JSON.parse(raw));await assertProjectReviewPacket(this.workspace,packet);return packet;}
 async writePacket(p){validateReviewPacket(p);await assertProjectReviewPacket(this.workspace,p);await this.workspace.writeMetadata(root+p.request.value.id+'.json',JSON.stringify(p));return writeReviewSummary(this.workspace,p);}
 async run(operation,data,options={}){
  requireValue(reviewOperations.includes(operation),'Review operation');
  const execute=()=>this.runValue(operation,data,options);
  return ['download','figure','figure-export','create','receive'].includes(operation)?this.workspace.withCatalogueConnections(execute):reviewReadOperations.includes(operation)?this.workspace.catalogue(execute):this.workspace.withLock(execute);
 }
 async runValue(operation,data,options={}){
  const {metadata}=await this.workspace.outline();requireValue(data.workspaceId===metadata.id,'Workspace changed');const index=await this.index();
  if(operation==='plan')return this.records.plan(metadata.id,data.scope);
  if(operation==='identity')return {contact:await this.identity.contact()};
  if(operation==='contact'){validateContact(data.contact);requireValue(text(data.name,160,true)&&data.verified===true,'Verify the contact fingerprint through another channel');const fingerprint=reviewHash(data.contact);requireValue(fingerprint!==reviewHash(await this.identity.contact()),'Choose another reviewer');const existing=index.contacts.find(c=>reviewHash(c.contact)===fingerprint);if(existing){existing.name=data.name;existing.active=true;}else{requireValue(index.contacts.length<200,'Contact limit');index.contacts.push({name:data.name,contact:data.contact,active:true});}await this.writeIndex(index);return {saved:true};}
  if(operation==='untrust'){const c=index.contacts.find(c=>reviewHash(c.contact)===data.fingerprint);requireValue(!!c,'Contact unavailable');c.active=false;await this.writeIndex(index);return {saved:true};}
  if(operation==='list')return reviewPage(this.workspace,index,data,id=>this.packet(id),this.records);
  if(operation==='create'){await this.stages.recover(options);return this.create(data,options);}
  if(operation==='receive'){requireValue(Object.keys(data).sort().join()==='workspaceId','Review upload selection');await this.stages.recover(options);return this.stages.run(parts=>this.receive(parts,options),options);}
  if(operation==='import'){
   const signed=await this.identity.open(data.file),v=signed.value;requireValue(index.contacts.some(c=>c.active&&reviewHash(c.contact)===reviewHash(v.sender)),'Verify the sender contact before importing a review');
   if(v.kind==='request'){
    requestValue(signed);requireValue(v.version!==2,'The complete figure package is required');requireValue(v.recipient===reviewHash(await this.identity.contact()),'Request recipient');if(index.ids.includes(v.id)){const p=await this.packet(v.id);requireValue(reviewHash(p.request)===reviewHash(signed)&&p.direction==='incoming','Request identity already used');return {id:v.id,replayed:true};}
    requireValue(index.ids.length<500,'Review request limit');const summary=await this.writePacket({direction:'incoming',request:signed,response:null});index.ids.push(v.id);await this.writeIndex(index,summary);return {id:v.id};
   }
   requireValue(uuid(v.requestId)&&index.ids.includes(v.requestId),'No matching outgoing request');const p=await this.packet(v.requestId);requireValue(p.direction==='outgoing','Review direction');responseValue(signed,p.request);if(p.response){requireValue(reviewHash(p.response)===reviewHash(signed),'A different response is already retained');return {id:v.requestId,replayed:true};}p.response=signed;await this.writePacket(p);return {id:v.requestId};
  }
  requireValue(uuid(data.id)&&index.ids.includes(data.id),'Review unavailable');const p=await this.packet(data.id);
  if(operation==='read')return {packet:p};
  if(['download','figure','figure-export'].includes(operation))return this.figureOperation(operation,data,p,options);
  if(operation==='respond'){
   requireValue(index.contacts.some(c=>c.active&&reviewHash(c.contact)===reviewHash(p.request.value.sender)),'Verify the request sender before responding');
   requireValue(p.direction==='incoming','Only received requests can be reviewed');if(p.response){requireValue(reviewHash(p.response.value.decisions)===reviewHash(data.decisions),'This review already has a different signed response');return {file:await this.identity.seal(p.response,p.request.value.sender),replayed:true};}const sender=await this.identity.contact();requireValue(p.request.value.recipient===reviewHash(sender),'Only the invited reviewer can sign');
   const response=await this.identity.sign({kind:'response',id:randomUUID(),requestId:data.id,requestHash:reviewHash(p.request),createdAt:new Date().toISOString(),sender,recipient:reviewHash(p.request.value.sender),decisions:data.decisions});responseValue(response,p.request);const file=await this.identity.seal(response,p.request.value.sender);p.response=response;await this.writePacket(p);return {file};
  }
  if(operation==='export'){requireValue(index.contacts.some(c=>c.active&&reviewHash(c.contact)===(p.direction==='incoming'?reviewHash(p.request.value.sender):p.request.value.recipient)),'Verify the recipient before exporting');if(p.direction==='outgoing'&&p.request.value.version===2)return {download:{id:data.id}};const signed=p.direction==='incoming'?p.response:p.request;requireValue(!!signed,'Sign a response first');const recipient=p.direction==='incoming'?p.request.value.sender:index.contacts.find(c=>reviewHash(c.contact)===p.request.value.recipient)?.contact;requireValue(!!recipient,'Verified recipient unavailable');return {file:await this.identity.seal(signed,recipient)};}
  throw Error('Unknown review operation');
 }
 async active(packet,{check,signal}={}){signal?.throwIfAborted();await check?.();const index=await this.index(),fingerprint=packet.direction==='incoming'?reviewHash(packet.request.value.sender):packet.request.value.recipient;requireValue(index.ids.includes(packet.request.value.id)&&index.contacts.some(c=>c.active&&reviewHash(c.contact)===fingerprint),'Verify the review contact before opening figures');return index.contacts.find(c=>reviewHash(c.contact)===fingerprint).contact;}
 async parts(packet){requireValue(packet.request.value.version===2&&uuid(packet.parts),'Review figures unavailable');const parts=new ExchangeParts(this.workspace,packet.parts,{scope:'reviews'}),head=await parts.open();requireValue(head.requestId===packet.request.value.id&&head.selectionHash===reviewHash(packet.request)&&head.direction===packet.direction,'Review figure membership');return parts;}
 async figureOperation(operation,data,packet,options){
  const allowed=['workspaceId','id',...(operation==='download'?[]:['recordId','recordRevision','figureId','expectedRevision',...(operation==='figure-export'?['format']:['operation','selection','window'])])];requireValue(Object.keys(data).every(k=>allowed.includes(k)),'Review figure selection');const contact=await this.active(packet,options),parts=await this.parts(packet),service=this;
  const download=async value=>{requireValue(typeof options.download==='function','Download unavailable');async function* guarded(){for await(const bytes of value.chunks){await service.active(packet,options);yield bytes;}}return options.download({...value,chunks:guarded()});};
  if(operation==='download'){
   requireValue(packet.direction==='outgoing','Only outgoing requests are downloadable');async function* entries(){const description=await parts.descriptor('description','selection');requireValue(!!description,'Review description');yield {...description,content:parts.content(description)};for await(const entry of parts.items())if(entry.kind!=='description')yield {...entry,content:parts.content(entry)};}
   return download({name:'review-'+packet.request.value.id+'.observanda-review',contentType:'application/octet-stream',chunks:writeExchange(this.identity.streamIdentity(),contact,entries(),{id:packet.request.value.id,signal:options.signal,keyAdapter:reviewExchangeKeys})});
  }
  const result=await readReviewFigure(parts,packet.request.value,data,{...options,download,exporting:operation==='figure-export'});await this.active(packet,options);return result;
 }

 async recover(options={}){return this.workspace.withCatalogueConnections(()=>this.stages.recover(options));}
 async create(data,options){
  requireValue(uuid(data.id)&&validReviewRecords(data.records)&&text(data.message,4000),'Choose 1 to 50 saved records per request');
  const admitted=await this.workspace.catalogue(async()=>{const index=await this.index(),contact=index.contacts.find(c=>c.active&&reviewHash(c.contact)===data.recipient);requireValue(!!contact,'Verify the reviewer contact first');if(index.ids.includes(data.id))return {packet:await this.replayCreate(data),contact};if(data.scope){const plan=await this.records.plan(data.workspaceId,data.scope);requireValue(JSON.stringify(plan.records.map(({id,revision})=>({id,revision})))===JSON.stringify(data.records),'The selection changed. Preview the selection again.');}return {records:await this.records.load(data.workspaceId,data.records),contact};});
  if(admitted.packet)return this.createdResult(admitted.packet,admitted.packet.request.value.version===2?null:admitted.contact?.contact);
  const {records}=admitted,sender=await this.identity.contact();const create=async parts=>{const figureParts=parts?await captureReviewFigures(this.workspace,parts,records,options):null;
  const request=await this.identity.sign({kind:'request',id:data.id,workspaceId:data.workspaceId,createdAt:new Date().toISOString(),sender,recipient:data.recipient,message:data.message,records,...(parts?{version:2,figureParts}:{})});requireValue(Buffer.byteLength(reviewText(request))<=750000,'Send up to 750 KB of selected record text per review');if(parts)await parts.add({kind:'description',name:'selection',content:reviewText(request)});
  const result=await this.workspace.withLock(async()=>{
   options.signal?.throwIfAborted();await options.check?.();const index=await this.index(),contact=index.contacts.find(c=>c.active&&reviewHash(c.contact)===data.recipient);requireValue(!!contact,'Verify the reviewer contact first');if(index.ids.includes(data.id))return {packet:await this.replayCreate(data),replayed:true,contact:contact.contact};
   await this.records.load(data.workspaceId,data.records);requireValue(index.ids.length<500,'Review request limit');if(parts){await this.workspace.catalogue(store=>requireReviewFigurePackages(store.db));await parts.finish({direction:'outgoing',requestId:data.id,selectionHash:reviewHash(request)},{write:operation=>operation()});}
   const packet={direction:'outgoing',request,response:null,...(parts?{parts:parts.id}:{})},summary=await this.writePacket(packet);index.ids.push(data.id);await this.writeIndex(index,summary);if(parts)await this.stages.finish(parts,data.id);return {packet,contact:contact.contact};
  });
  return this.createdResult(result.packet,result.contact);};return hasReviewFigures(records)?this.stages.run(create,{...options,requestId:data.id}):create(null);
 }
 async replayCreate(data){const p=await this.packet(data.id);requireValue(p.direction==='outgoing'&&p.request.value.recipient===data.recipient&&p.request.value.message===data.message&&JSON.stringify(p.request.value.records.map(({id,revision})=>({id,revision})))===JSON.stringify(data.records),'Request identity already used');return p;}
 async createdResult(packet,contact){if(packet.request.value.version===2)return {download:{id:packet.request.value.id}};contact??=(await this.index()).contacts.find(c=>c.active&&reviewHash(c.contact)===packet.request.value.recipient)?.contact;requireValue(!!contact,'Verify the reviewer contact first');return {file:await this.identity.seal(packet.request,contact)};}
 async receive(parts,options){
  requireValue(options.stream&&typeof options.stream[Symbol.asyncIterator]==='function','Review stream');let request=null;
  const result=await readExchange(this.identity.streamIdentity(),options.stream,async(info,content)=>{
   options.signal?.throwIfAborted();if(!request){requireValue(info.kind==='description'&&info.name==='selection'&&info.size<=750000,'Review description');await parts.receive(info,content);request=await parts.value('description','selection');const value=requestValue(request),index=await this.index();requireValue(value.version===2&&value.recipient===reviewHash(await this.identity.contact())&&index.contacts.some(c=>c.active&&reviewHash(c.contact)===reviewHash(value.sender)),'Verify the sender contact before importing a review');await this.stages.bind(parts,value.id);}
   else{requireValue(info.kind==='metadata'&&info.size<=262144,'Review figure block');const entry=await parts.receive(info,content);await indexReviewFigurePart(parts,entry,options);}
  },options);
  requireValue(request&&result.id===request.value.id&&result.sender.id===request.value.sender.signing.id,'Review sender');await verifyReviewFigures(parts,request.value,options);
  const response=await this.workspace.withLock(async()=>{
   options.signal?.throwIfAborted();await options.check?.();const index=await this.index();requireValue(index.contacts.some(c=>c.active&&reviewHash(c.contact)===reviewHash(request.value.sender)),'Verify the sender contact before importing a review');
   if(index.ids.includes(request.value.id)){const old=await this.packet(request.value.id);requireValue(old.direction==='incoming'&&reviewHash(old.request)===reviewHash(request),'Request identity already used');return {id:request.value.id,replayed:true};}
   requireValue(index.ids.length<500,'Review request limit');await this.workspace.catalogue(store=>requireReviewFigurePackages(store.db));await parts.finish({direction:'incoming',requestId:request.value.id,selectionHash:reviewHash(request),attestation:result.attestation},{write:operation=>operation()});const summary=await this.writePacket({direction:'incoming',request,response:null,parts:parts.id});index.ids.push(request.value.id);await this.writeIndex(index,summary);await this.stages.finish(parts,request.value.id);return {id:request.value.id};
  });
  return response;
 }

}
