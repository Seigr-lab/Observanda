// Template instructions share immutable value/index blocks under the workspace
// metadata key. A draft or release pins a root; edits never rewrite old roots.
import {createHash} from 'node:crypto';
import {RecordValueTree} from './record-value-tree.js';
import {RecordDocument} from './record-document.js';
import {digest,serialize} from './storage-format.js';
import {revisionId} from './web/revision-model.js';
import {validStarter} from './web/record-starter-model.js';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {catalogueFormat} from './catalogue-format.js';
import {researchId} from './web/research-reference.js';
const prefix='.observanda/record-starter-values',format='observanda-starter-document';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const starterDocumentPointer=value=>value?.format===format;
export class StarterValueBlocks{
 constructor(workspace,{temporary=false,staging=null}={}){if(staging!==null&&!researchId(staging))fail();this.workspace=workspace;this.prefix=staging?'.observanda/record-starter-staging/'+staging:prefix;this.temporary=temporary;this.values=new Map();this.bytes=0;}
 file(kind,revision){if(!['value','index'].includes(kind)||!revisionId(revision))fail();return this.prefix+'/'+kind+'/'+revision+'.json';}
 keep(file,text){
  if(this.values.has(file))return;
  if(!this.temporary)while(this.values.size>=32||this.bytes+Buffer.byteLength(text)>1024*1024){const [key,value]=this.values.entries().next().value;this.values.delete(key);this.bytes-=Buffer.byteLength(value);}
  this.values.set(file,text);this.bytes+=Buffer.byteLength(text);
 }
 async read(kind,revision){
  const file=this.file(kind,revision),text=this.values.get(file)??await this.workspace.readMetadata(file,65536);if(text===null||digest(text)!==revision)fail();
  let value;try{value=JSON.parse(text);}catch{fail();}if(serialize(value)!==text)fail();this.keep(file,text);return value;
 }
 async put(kind,value){
  const text=serialize(value);if(Buffer.byteLength(text)>65536)throw new AppError('INVALID');const revision=digest(text),file=this.file(kind,revision);
  if(this.values.has(file))return revision;
  if(!this.temporary){const prior=await this.workspace.readMetadata(file,65536);if(prior!==null&&prior!==text)fail();if(prior===null)await this.workspace.writeMetadata(file,text);}
  this.keep(file,text);return revision;
 }
 async flush(){}
 tree(){return new RecordValueTree(this);}
}
export async function starterDocument(workspace,value,{mutable=false}={}){
 const retained=starterDocumentPointer(value);
 if(retained&&!(Object.keys(value).sort().join()==='fingerprint,format,root,version'&&value.version===1&&revisionId(value.root)&&revisionId(value.fingerprint)))fail();
 if(retained&&await workspace.catalogue(store=>catalogueFormat(store.db))<21)fail();
 const blocks=new StarterValueBlocks(workspace,{temporary:!retained&&!mutable});
 if(!retained&&!validStarter(value))fail();
 return new RecordDocument(blocks,retained?value.root:await blocks.tree().retain(value),{mutable});
}
export async function starterFingerprint(document,{signal}={}){
 const hash=createHash('sha256');for await(const text of document.tree.json(document.root,{canonical:true,signal}))hash.update(text);return hash.digest('hex');
}
export async function retainStarterDocument(document,options){return {format,version:1,root:document.root,fingerprint:await starterFingerprint(document,options)};}
export async function validateStarterDocument(document,{portable=true,signal}={}){
 const names=await document.tree.propertyNames(document.root);if(names.sort().join()!=='body,name,sections,tags,title,type')throw new AppError('STARTER_INVALID');
 const header={sections:[],tags:[]};for(const name of ['name','type','title','body'])header[name]=(await document.field([name],{signal})).value;
 if(!validStarter(header,{portable}))throw new AppError('STARTER_INVALID');
 const sections=await document.tree.arrayLength(document.root,['sections']);for(let index=0;index<sections;index++)if(!validStarter({...header,body:'',sections:[(await document.field(['sections',String(index)],{signal})).value]},{portable}))throw new AppError('STARTER_INVALID');
 const tags=await document.tree.arrayLength(document.root,['tags']);if(tags)await withScratch(async seen=>{for(let index=0;index<tags;index++){const tag=(await document.field(['tags',String(index)],{signal})).value;if(!validStarter({...header,body:'',tags:[tag]},{portable})||!await seen.add(tag))throw new AppError('STARTER_INVALID');}},{signal});
 return header;
}
export async function verifyStarterDocument(workspace,pointer,{signal,portable=true}={}){
 const document=await starterDocument(workspace,pointer);await validateStarterDocument(document,{signal,portable});
 if(starterDocumentPointer(pointer)&&await starterFingerprint(document,{signal})!==pointer.fingerprint)fail();return document;
}
