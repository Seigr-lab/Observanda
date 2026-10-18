import {WorkspaceFonts,inspectUploadedFont} from './workspace-fonts.js';
import {withoutRecordOwnerResourceAdoption} from './record-owner-resources.js';
import {MAX_FONT_BYTES} from './font-inspector.js';
import {customFontId,validCustomFont} from './web/font-catalogue.js';
import {validPdfFontPin,validPdfFontPins} from './web/pdf-font-model.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {RecordValueTree} from './record-value-tree.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const hash=value=>digest(serialize(value));
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const fail=code=>{throw new AppError(code);};
const preparedFonts=new WeakMap();
const owner=(store,id)=>{if(store?.domain!=='pdf'||!researchId(id))fail('INVALID');};
const fontMetadata=font=>({id:font.id,label:font.label,embed:font.embed,restricted:font.restricted,hidden:font.hidden,faces:font.faces.map(face=>({file:face.file,style:face.style,weight:[...face.weight],axes:structuredClone(face.axes)}))});
function matchesFont(font,info){
 return validCustomFont(font)&&font.id==='custom-'+info.sha256&&font.label===info.label&&font.restricted===info.restricted&&font.faces[0].file===font.id+'.'+info.extension&&font.faces[0].style===info.style&&hash(font.faces[0].weight)===hash(info.weight)&&hash(font.faces[0].axes)===hash(info.axes);
}
// Source authorization and font inspection finish before the independent PDF
// writer starts. The private owned bytes cannot change across later awaits.
export async function preparePdfFont(storage,fontId,{signal,check=async()=>{}}={}){
 if(!customFontId(fontId))fail('INVALID');await check();signal?.throwIfAborted();
 const read=()=>withoutRecordOwnerResourceAdoption(()=>new WorkspaceFonts(storage).get(fontId));
 const source=await (storage.storageKind&&await storage.storageKind()==='catalogue'?storage.catalogue(read):read()),bytes=Buffer.from(source.bytes),font=fontMetadata(source);
 if(!font.embed||font.restricted)fail('FONT_EMBED');const info=await inspectUploadedFont(bytes,{signal});
 if(info.restricted)fail('FONT_EMBED');if(!matchesFont(font,info))fail('FONT_INVALID');
 await check();signal?.throwIfAborted();const prepared=Object.freeze({id:font.id,label:font.label,sha256:info.sha256,size:bytes.length});preparedFonts.set(prepared,{font,bytes});return prepared;
}
class PdfFontBlocks{
 constructor(store,id,signal){owner(store,id);this.store=store;this.id=id;this.signal=signal;}
 key(kind,revision){if(!['value','index'].includes(kind)||!revisionId(revision))fail('CATALOGUE_DAMAGED');return 'pdf-font:block:'+this.id+':'+kind+':'+revision;}
 async put(kind,value){
  this.signal?.throwIfAborted();const text=serialize(value);if(Buffer.byteLength(text)>65536)fail('PDF_CAPACITY');const revision=digest(text),key=this.key(kind,revision),previous=await this.store.object(key);
  if(previous&&hash(previous)!==revision)fail('CATALOGUE_DAMAGED');if(!previous)await this.store.putObject(key,value);return revision;
 }
 async read(kind,revision){this.signal?.throwIfAborted();const value=await this.store.object(this.key(kind,revision));if(!value||hash(value)!==revision||Buffer.byteLength(serialize(value))>65536)fail('CATALOGUE_DAMAGED');return value;}
}
export async function retainPdfDocumentFont(store,documentId,prepared,{signal}={}){
 owner(store,documentId);signal?.throwIfAborted();const source=preparedFonts.get(prepared);if(!source)fail('INVALID');
 const root=await new RecordValueTree(new PdfFontBlocks(store,documentId,signal)).retain(source.bytes.toString('base64'));
 const descriptor={version:1,documentId,id:prepared.id,sha256:prepared.sha256,size:prepared.size,font:source.font,root},revision=hash(descriptor),key='pdf-font:value:'+documentId+':'+revision,old=await store.object(key);
 if(old&&hash(old)!==revision)fail('CATALOGUE_DAMAGED');if(!old)await store.putObject(key,descriptor);signal?.throwIfAborted();return {id:prepared.id,revision};
}
async function descriptor(store,documentId,pin,{signal}={}){
 owner(store,documentId);if(!validPdfFontPin(pin))fail('INVALID');signal?.throwIfAborted();
 const value=await store.object('pdf-font:value:'+documentId+':'+pin.revision);
 if(!exact(value,'version,documentId,id,sha256,size,font,root')||value.version!==1||value.documentId!==documentId||value.id!==pin.id||value.sha256!==pin.id.slice(7)||hash(value)!==pin.revision||!Number.isSafeInteger(value.size)||value.size<64||value.size>MAX_FONT_BYTES||!revisionId(value.root)||!validCustomFont(value.font)||!exact(value.font,'id,label,embed,restricted,hidden,faces')||!exact(value.font.faces[0],'file,style,weight,axes')||value.font.id!==pin.id||!value.font.embed||value.font.restricted)fail('CATALOGUE_DAMAGED');
 return value;
}
export async function describePdfDocumentFont(store,documentId,pin,options){const value=await descriptor(store,documentId,pin,options);return {...value.font,revision:pin.revision};}
export async function readPdfDocumentFont(store,documentId,pin,{signal}={}){
 const value=await descriptor(store,documentId,pin,{signal});
 const tree=new RecordValueTree(new PdfFontBlocks(store,documentId,signal)),node=await tree.node(value.root),length=Math.ceil(value.size/3)*4;
 if(node.type==='inline'?typeof node.value!=='string'||node.value.length!==length:node.type!=='string'||node.bytes!==length+3)fail('CATALOGUE_DAMAGED');
 const encoded=await tree.read(value.root);
 if(typeof encoded!=='string'||encoded.length!==Math.ceil(value.size/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))fail('CATALOGUE_DAMAGED');const bytes=Buffer.from(encoded,'base64');
 if(bytes.length!==value.size||bytes.toString('base64')!==encoded||digest(bytes)!==value.sha256)fail('CATALOGUE_DAMAGED');
 let info;try{info=await inspectUploadedFont(bytes,{signal});}catch(error){signal?.throwIfAborted();fail('CATALOGUE_DAMAGED');}
 if(!matchesFont(value.font,info)||info.restricted)fail('CATALOGUE_DAMAGED');return {...value.font,bytes,revision:pin.revision};
}
// Called for every historical header. The verifier can reuse authenticated
// proofs within its fixed PDF-owner snapshot, never across mutable libraries.
export async function verifyPdfDocumentFonts(store,header,{signal,once=async(_key,check)=>check()}={}){
 owner(store,header?.id);const fonts=header.fonts??[];if(!validPdfFontPins(fonts))fail('CATALOGUE_DAMAGED');
 for(const pin of fonts){signal?.throwIfAborted();await once(['pdf-document-font',header.id,pin.id,pin.revision],()=>readPdfDocumentFont(store,header.id,pin,{signal}));}
 return {fonts:fonts.length};
}

// Copy only an authenticated retained font; layouts and documents each own
// their bytes, so removing the source library or document cannot change them.
export async function copyPdfDocumentFont(store,sourceId,pin,targetId,{signal}={}){
 const source=await readPdfDocumentFont(store,sourceId,pin,{signal}),bytes=Buffer.from(source.bytes),font=fontMetadata(source);
 const prepared=Object.freeze({id:font.id,label:font.label,sha256:font.id.slice(7),size:bytes.length});preparedFonts.set(prepared,{font,bytes});
 return retainPdfDocumentFont(store,targetId,prepared,{signal});
}
