import {AppError} from './errors.js';
import {requirePdfDomainFormat,assertPdfDomainFormat} from './pdf-domain-format.js';
import {revisionId} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
import {resolveLanguage,validLanguage} from './web/i18n/runtime.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {digest,serialize} from './storage-format.js';
import {bundledPublicationStarters,pdfStarterRevision,publicationLanguage,validatePublicationStarter} from './pdf-publication-starters.js';

const validId=researchId,fail=code=>{throw new AppError(code);};
const sameKeys=(obj,...keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).length===keys.length&&keys.every(key=>Object.hasOwn(obj,key));
const stored=(value)=>{try{return validatePublicationStarter(value,{checkFont:false});}catch(e){if(e.code==='PDF_TEMPLATE_COMPONENT')fail('CATALOGUE_DAMAGED');throw e;}};
const catalogCache=new Map();
function builtin(language){
 if(!publicationLanguage(language))fail('INVALID');language=resolveLanguage(language);
 if(!catalogCache.has(language))catalogCache.set(language,bundledPublicationStarters(language).map(value=>({revision:pdfStarterRevision(value),value})));
 return catalogCache.get(language);
}
export function validPublicationOrigin(pin){
 return sameKeys(pin,'id','revision','sections')&&validId(pin.id)&&revisionId(pin.revision)&&Array.isArray(pin.sections)&&pin.sections.length>=1&&pin.sections.length<=256&&pin.sections.every(row=>sameKeys(row,'slot','sectionId')&&validId(row.slot)&&validId(row.sectionId))&&new Set(pin.sections.map(row=>row.slot)).size===pin.sections.length&&new Set(pin.sections.map(row=>row.sectionId)).size===pin.sections.length;
}
export function validateTemplatePublication(input){
 if(!sameKeys(input,'commandId','expectedRevision','value')||!validId(input.commandId)||input.expectedRevision!==null&&!revisionId(input.expectedRevision))fail('INVALID');
 const value=validatePublicationStarter(input.value);
 if(builtin(value.language).some(x=>x.value.id===value.id))fail('INVALID');
 return value;
}
export class PublicationTemplates{
 constructor(store){this.store=store;}
 index(){
  const key=(kind,revision)=>{if(!['index','value'].includes(kind)||!revisionId(revision))fail('CATALOGUE_DAMAGED');return 'pdf-template:block:'+kind+':'+revision;};
  return new RetainedTableIndex({read:async(kind,revision)=>{const value=await this.store.object(key(kind,revision));if(!value||digest(serialize(value))!==revision)fail('CATALOGUE_DAMAGED');return value;},
   put:async(kind,value)=>{const revision=digest(serialize(value));await this.store.putObject(key(kind,revision),value);return revision;}},{namespace:'index',allowSparseBranches:true});
 }
 async directory(){
  const directory=await this.store?.object('pdf-template:directory');
  if(!directory)return {version:1,root:null};
  if(!sameKeys(directory,'version','root')||directory.version!==1||!validTableRef(directory.root))fail('CATALOGUE_DAMAGED');
  await assertPdfDomainFormat(this.store,9);return directory;
 }
 async value(id,revision){
  if(!validId(id)||!revisionId(revision))fail('INVALID');
  const value=await this.store?.object('pdf-template:value:'+revision);
  if(!value||value.id!==id||pdfStarterRevision(value)!==revision)fail('CATALOGUE_DAMAGED');return stored(value);
 }
 async head(id,language){
  if(!validId(id)||!publicationLanguage(language))fail('INVALID');
  const built=builtin(language).find(x=>x.value.id===id);if(built)return structuredClone({...built,builtIn:true});
  const index=this.index(),row=await index.find(await this.directory(),id);if(!row)fail('NOT_FOUND');
  return {value:await this.value(id,row.revision),revision:row.revision,builtIn:false};
 }
 async list({language,after=null,limit=20}){
  if(!validLanguage(language)||after!==null&&!validId(after)||!Number.isInteger(limit)||limit<1||limit>100)fail('INVALID');
  const summary=({revision,value},builtIn)=>({id:value.id,name:value.name,revision,language:value.language,sections:value.sections.length,builtIn});
  const defaults=after?[]:builtin(language).map(row=>summary(row,true));
  const index=this.index(),directory=await this.directory(),total=directory.root?.count??0,items=[];
  const start=after?await index.rank(directory,after)+(await index.find(directory,after)?1:0):0;
  for(let i=start;i<total&&items.length<limit;i++){
   const row=await index.entryAt(directory,i);
   items.push(summary({value:await this.value(row.id,row.revision),revision:row.revision},false));
  }
  return {items:[...defaults,...items],next:start+items.length<total?items.at(-1).id:null};
 }
 async resolve(pin){
  if(!sameKeys(pin,'id','revision','language')||!validId(pin.id)||!revisionId(pin.revision))fail('INVALID');
  const current=await this.head(pin.id,pin.language);if(current.revision!==pin.revision)fail('CONFLICT');
  return validatePublicationStarter(current.value);
 }
 async retain(value){
  const revision=pdfStarterRevision(value);await this.store.putObject('pdf-template:value:'+revision,value);return revision;
 }
 async publish(input,{signal}={}){
  const value=validateTemplatePublication(input),{id}=value;
  await requirePdfDomainFormat(this.store,9);
  const key='pdf-template:command:'+id+':'+input.commandId,signature=pdfStarterRevision(input),receipt=await this.store.object(key);
  if(receipt){if(!sameKeys(receipt,'signature','revision')||!revisionId(receipt.revision))fail('CATALOGUE_DAMAGED');if(receipt.signature!==signature)fail('MODULE_REPLAY');await this.value(id,receipt.revision);return {revision:receipt.revision,replayed:true};}
  const directory=await this.directory(),index=this.index(),prior=await index.find(directory,id);
  if((prior?.revision??null)!==input.expectedRevision)fail('CONFLICT');
  const revision=await this.retain(value);
  directory.root=await index.change(directory.root,id,revision);await index.flush(directory.root);
  await this.store.putObject('pdf-template:directory',directory);await this.store.putObject(key,{signature,revision});signal?.throwIfAborted();
  return {revision,replayed:false};
 }
 async verify({signal}={}){
  const directory=await this.directory();if(!directory.root)return;
  for await(const row of this.index().entries(directory)){signal?.throwIfAborted();await this.value(row.id,row.revision);}
 }
}
