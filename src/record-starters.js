import {starterRequestMatches} from './project-starter-receipts.js';
import {AppError} from './errors.js';
import {MetadataFeed} from './metadata-feed.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validStarter,starterKeys,starterText,STARTER_BYTES} from './web/record-starter-model.js';
import {requireStarterDocuments} from './catalogue-format.js';
import {packageDigest,sealStarter,openStarter} from './record-starter-package.js';
import {StarterValueBlocks,starterDocument,starterDocumentPointer,retainStarterDocument,validateStarterDocument} from './record-starter-documents.js';
import {RecordDocument} from './record-document.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {createStarterRecord} from './record-starter-creation.js';
export const STARTER_ROOT='.observanda/record-starters';
const ROOT=STARTER_ROOT,headers=ROOT+'/headers',releases=ROOT+'/releases';
const stamp=v=>({...v,revision:packageDigest(v)});
const check=(value,keys)=>{if(!starterKeys(value,keys)||!researchId(value.workspaceId))throw new AppError('INVALID');};
const identifier=id=>{if(!researchId(id))throw new AppError('INVALID');return id;};
export class RecordStarters{
 constructor(workspace,evidence){this.workspace=workspace;this.evidence=evidence;this.feed=new MetadataFeed(workspace,headers);}
 async context(workspaceId){const {metadata}=await this.workspace.outline();if(metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');return metadata;}
 async object(file){const raw=await this.workspace.readMetadata(file,STARTER_BYTES+16384);if(raw===null)return null;try{return JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}}
 async header(id){const v=await this.object(headers+'/'+identifier(id)+'.json');if(!v)throw new AppError('NOT_FOUND');if(v.id!==id||v.version!==1||!['active','archived'].includes(v.status)||!Number.isSafeInteger(v.sequence))throw new AppError('CATALOGUE_DAMAGED');return stamp(v);}
 async list(c){check(c,['workspaceId','cursor']);await this.context(c.workspaceId);return this.workspace.catalogue(async()=>{const page=await this.feed.page({cursor:c.cursor,limit:20}),items=[];for(const item of page.items)items.push(await this.header(item.id));return {items,next:page.next};});}
 async draftDocument(header,options){const value=await this.object(ROOT+'/drafts/'+header.id+'.json');if(!value||(starterDocumentPointer(value)?value.fingerprint:packageDigest(value))!==header.draftHash)throw new AppError('CATALOGUE_DAMAGED');return starterDocument(this.workspace,value,options);}
 async read(c){check(c,['workspaceId','id']);return this.workspace.catalogue(async()=>{await this.context(c.workspaceId);const header=await this.header(c.id),document=await this.draftDocument(header);return {header,draft:await document.tree.read(document.root)};});}
 async releaseDocument(c){
  check(c,['workspaceId','id','release']);await this.context(c.workspaceId);identifier(c.id);if(!revisionId(c.release))throw new AppError('INVALID');
  const value=await this.object(releases+'/'+c.id+'/'+c.release+'.json');if(!value)throw new AppError('NOT_FOUND');
  if(starterDocumentPointer(value)){if(value.fingerprint!==c.release)throw new AppError('CATALOGUE_DAMAGED');return starterDocument(this.workspace,value);}
  if(packageDigest(value)!==c.release||!validStarter(value.blueprint))throw new AppError('CATALOGUE_DAMAGED');
  const blocks=new StarterValueBlocks(this.workspace,{temporary:true});return new RecordDocument(blocks,await blocks.tree().retain(value));
 }
 async release(c){return this.workspace.catalogue(async()=>{const document=await this.releaseDocument(c);return {...await document.tree.read(document.root),revision:c.release};});}
 async history(c){check(c,['workspaceId','id','cursor']);await this.context(c.workspaceId);await this.header(c.id);if(c.cursor!==null&&(typeof c.cursor!=='string'||!/^\d{9}\.json$/.test(c.cursor)))throw new AppError('INVALID');const page=await this.workspace.metadataPage(ROOT+'/history/'+c.id,{after:c.cursor,limit:20});return {items:page.items.map(v=>JSON.parse(v.text)),next:page.next};}
 async save(c){
  check(c,['workspaceId','id','expectedRevision','draft']);identifier(c.id);if(!(c.expectedRevision===null||revisionId(c.expectedRevision))||!validStarter(c.draft))throw new AppError('STARTER_INVALID');
  return this.workspace.withLock(()=>this.saveLocked(c));
 }
 async saveLocked(c,origin=null){
  await this.context(c.workspaceId);await this.feed.ensureLocked();
  const prior=await this.object(headers+'/'+c.id+'.json'),draftHash=packageDigest(c.draft);
  if(prior?.draftHash===draftHash&&prior.status==='active')return this.read({workspaceId:c.workspaceId,id:c.id});
  if((prior?packageDigest(prior):null)!==c.expectedRevision)throw new AppError('STARTER_CHANGED');
  if(prior?.status==='archived')throw new AppError('STARTER_ARCHIVED');
  const header=prior??{version:1,id:c.id,createdAt:new Date().toISOString(),status:'active',sequence:0,latest:null,...(origin?{origin}: {})};
  Object.assign(header,{name:c.draft.name,draftHash});
  await this.workspace.catalogue(store=>requireStarterDocuments(store.db));const blocks=new StarterValueBlocks(this.workspace),document=new RecordDocument(blocks,await blocks.tree().retain(c.draft));
  await this.workspace.writeMetadata(ROOT+'/drafts/'+c.id+'.json',JSON.stringify(await retainStarterDocument(document)));
  await this.workspace.writeMetadata(headers+'/'+c.id+'.json',JSON.stringify(header));if(!prior)await this.feed.putLocked(header);
  return {header:stamp(header),draft:c.draft};
 }
 async publish(c,{compact=false}={}){
  check(c,['workspaceId','id','expectedRevision','note']);identifier(c.id);if(!revisionId(c.expectedRevision)||!starterText(c.note,2000,true))throw new AppError('INVALID');
  return this.workspace.withLock(async()=>{
   await this.context(c.workspaceId);const h=await this.header(c.id),result=async()=>{const header=await this.header(c.id);return {header,release:compact?{revision:header.latest}:await this.release({workspaceId:c.workspaceId,id:c.id,release:header.latest})};};
   if(h.latest){const last=await this.releaseDocument({workspaceId:c.workspaceId,id:c.id,release:h.latest});if((await last.field(['previousRevision'])).value===c.expectedRevision&&(await last.field(['note'])).value===c.note)return result();}
   if(h.revision!==c.expectedRevision)throw new AppError('STARTER_CHANGED');if(h.status==='archived')throw new AppError('STARTER_ARCHIVED');
   if(h.sequence>=999999998)throw new AppError('LIMIT');
   await this.workspace.catalogue(store=>requireStarterDocuments(store.db));const document=await this.draftDocument(h,{mutable:true});await validateStarterDocument(document);
   const metadata={version:1,number:h.sequence+1,createdAt:new Date().toISOString(),previousRevision:h.revision,note:c.note},builder=new RecordContainerBuilder(document.blocks,'object');
   for(const [name,value] of Object.entries(metadata))await builder.add({name,value:await document.tree.retain(value)});await builder.add({name:'blueprint',value:document.root});
   const release=await retainStarterDocument(new RecordDocument(document.blocks,await builder.finish()));
   await this.workspace.writeMetadata(releases+'/'+c.id+'/'+release.fingerprint+'.json',JSON.stringify(release));
   await this.workspace.writeMetadata(ROOT+'/history/'+c.id+'/'+String(999999999-metadata.number).padStart(9,'0')+'.json',JSON.stringify({number:metadata.number,revision:release.fingerprint,createdAt:metadata.createdAt,note:metadata.note}));
   const {revision,...header}=h;Object.assign(header,{latest:release.fingerprint,sequence:metadata.number,releasedDraftHash:h.draftHash});await this.workspace.writeMetadata(headers+'/'+c.id+'.json',JSON.stringify(header));return result();
  });
 }
 async archive(c){
  check(c,['workspaceId','id','expectedRevision','archived']);identifier(c.id);if(!revisionId(c.expectedRevision)||typeof c.archived!=='boolean')throw new AppError('INVALID');
  return this.workspace.withLock(async()=>{await this.context(c.workspaceId);const {revision,...header}=await this.header(c.id),status=c.archived?'archived':'active';if(header.status!==status){if(revision!==c.expectedRevision)throw new AppError('STARTER_CHANGED');header.status=status;await this.workspace.writeMetadata(headers+'/'+c.id+'.json',JSON.stringify(header));}return {header:stamp(header)};});
 }
 async create(c){
  check(c,['workspaceId','id','release','recordId','notebookId']);identifier(c.id);identifier(c.recordId);identifier(c.notebookId);if(!revisionId(c.release))throw new AppError('INVALID');
  return this.workspace.withLock(async()=>{
   const metadata=await this.context(c.workspaceId),file=ROOT+'/uses/'+c.recordId+'.json',prior=await this.object(file),commandHash=packageDigest(c);
   if(prior){if(!await starterRequestMatches(this.workspace,c,prior,'commandHash',file))throw new AppError('STARTER_CHANGED');return {recordId:c.recordId};}
   if((await this.header(c.id)).status==='archived')throw new AppError('STARTER_ARCHIVED');
   if(!metadata.notebooks.some(n=>n.id===c.notebookId))throw new AppError('NOT_FOUND');
   const release=await this.releaseDocument({workspaceId:c.workspaceId,id:c.id,release:c.release}),created=await createStarterRecord(this.workspace,release,c);
   await this.workspace.writeMetadata(file,JSON.stringify({commandHash,templateId:c.id,release:c.release,...created}));return {recordId:c.recordId};
  });
 }
 async origin(c){check(c,['workspaceId','recordId']);await this.context(c.workspaceId);return {origin:await this.object(ROOT+'/uses/'+identifier(c.recordId)+'.json')};}
 async export(c){check(c,['workspaceId','id','release','password']);const v=await this.release({workspaceId:c.workspaceId,id:c.id,release:c.release});return {encoded:await sealStarter({version:1,blueprint:v.blueprint,sourceRelease:v.revision,sourceNumber:v.number,releaseMetadata:{createdAt:v.createdAt,previousRevision:v.previousRevision,note:v.note}},c.password)};}
 async preview(c){check(c,['workspaceId','encoded','password']);await this.context(c.workspaceId);const value=await openStarter(c.encoded,c.password);return {value,digest:packageDigest(value)};}
 async import(c){
  check(c,['workspaceId','id','encoded','password','digest']);identifier(c.id);if(!revisionId(c.digest))throw new AppError('INVALID');const {value,digest}=await this.preview({workspaceId:c.workspaceId,encoded:c.encoded,password:c.password});if(digest!==c.digest)throw new AppError('STARTER_CHANGED');
  return this.workspace.withLock(()=>this.saveLocked({workspaceId:c.workspaceId,id:c.id,expectedRevision:null,draft:value.blueprint},{packageDigest:digest,release:value.sourceRelease,number:value.sourceNumber}));
 }
}
