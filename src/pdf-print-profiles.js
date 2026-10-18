import {RecordValueTree} from './record-value-tree.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {PDF_ICC_MAX_BYTES} from './web/pdf-print-condition-model.js';
import {inspectPdfIcc} from './pdf-print-icc.js';
import {AppError} from './errors.js';
const fail=(code='CATALOGUE_DAMAGED')=>{throw new AppError(code);},hash=value=>digest(serialize(value)),prepared=new WeakMap();
export function preparePdfPrintProfile(input){const bytes=Buffer.from(input),metadata=Object.freeze(inspectPdfIcc(bytes));prepared.set(metadata,bytes);return metadata;}
class Blocks{
 constructor(store,id,signal){this.store=store;this.id=id;this.signal=signal;}
 key(kind,revision){if(!['value','index'].includes(kind)||!revisionId(revision))fail();return 'pdf:print-block:'+this.id+':'+kind+':'+revision;}
 async put(kind,value){this.signal?.throwIfAborted();const text=serialize(value);if(Buffer.byteLength(text)>65536)fail();const revision=digest(text),key=this.key(kind,revision),old=await this.store.object(key);if(old!==null&&hash(old)!==revision)fail();if(old===null)await this.store.putObject(key,value);return revision;}
 async read(kind,revision){this.signal?.throwIfAborted();const value=await this.store.object(this.key(kind,revision));if(!value||Buffer.byteLength(serialize(value))>65536||hash(value)!==revision)fail();return value;}
}
export class PdfPrintProfiles{
 constructor(store,id){if(store?.domain!=='pdf'||!researchId(id))fail('INVALID');this.store=store;this.id=id;}
 async retain(value,{signal}={}){signal?.throwIfAborted();const bytes=prepared.get(value);if(!bytes)fail('INVALID');const root=await new RecordValueTree(new Blocks(this.store,this.id,signal)).retain(bytes.toString('base64')),descriptor={version:1,documentId:this.id,sha256:value.sha256,size:value.size,iccVersion:value.version,colorSpace:value.colorSpace,channels:value.channels,root},revision=hash(descriptor),key='pdf:print-profile:'+this.id+':'+revision,old=await this.store.object(key);if(old!==null&&hash(old)!==revision)fail();if(old===null)await this.store.putObject(key,descriptor);return {sha256:value.sha256,revision};}
 async descriptor(pin){if(!pin||Object.keys(pin).sort().join()!=='revision,sha256'||!revisionId(pin.revision)||!revisionId(pin.sha256))fail('INVALID');const v=await this.store.object('pdf:print-profile:'+this.id+':'+pin.revision);if(!v||Object.keys(v).sort().join()!=='channels,colorSpace,documentId,iccVersion,root,sha256,size,version'||v.documentId!==this.id||hash(v)!==pin.revision||v.sha256!==pin.sha256||v.version!==1||![2,4].includes(v.iccVersion)||!revisionId(v.root)||!Number.isSafeInteger(v.size)||v.size<132||v.size>PDF_ICC_MAX_BYTES||v.channels!==({RGB:3,CMYK:4,GRAY:1}[v.colorSpace]))fail();return v;}
 async read(pin,{signal}={}){signal?.throwIfAborted();const v=await this.descriptor(pin),tree=new RecordValueTree(new Blocks(this.store,this.id,signal)),limit=4*Math.ceil(v.size/3)+2,chunks=[];let size=0;for await(const chunk of tree.json(v.root,{canonical:true,signal})){size+=Buffer.byteLength(chunk);if(size>limit)fail();chunks.push(chunk);}let encoded;try{encoded=JSON.parse(chunks.join(''));}catch{fail();}if(typeof encoded!=='string'||size!==limit)fail();const bytes=Buffer.from(encoded,'base64');if(bytes.length!==v.size||bytes.toString('base64')!==encoded||digest(bytes)!==pin.sha256)fail();try{const checked=inspectPdfIcc(bytes);if(checked.version!==v.iccVersion||checked.colorSpace!==v.colorSpace||checked.channels!==v.channels)fail();}catch{fail();}return bytes;}
}
