import {ResearchMaterials,materialRef} from './research-materials.js';
import {AppError} from './errors.js';
import {exact} from './modules/validation.js';
import {BOM_IMPORT_BYTES,readBOMTable,mapBOMTable,validBOMMapping} from './web/modules/bom-import-model.js';
import {bomImportError} from './web/modules/bom-import-diagnostics.js';

const invalid=error=>new AppError('MODULE_INVALID',[{field:error.message,...(error.diagnostic?{diagnostic:error.diagnostic}:{})}]);
const requireSource=(valid,key)=>{if(!valid)throw invalid(bomImportError(key));};

export function validBOMSource(source){
 return exact(source,['version','artifact','sha256','size','name','delimiter','mapping','referenceSeparator'])&&source.version===1
  &&exact(source.artifact,['kind','id','revision'])&&source.artifact.kind==='artifact'&&materialRef(source.artifact)
  &&typeof source.sha256==='string'&&/^[a-f0-9]{64}$/.test(source.sha256)&&Number.isSafeInteger(source.size)&&source.size>0&&source.size<=BOM_IMPORT_BYTES
  &&typeof source.name==='string'&&source.name.length<=300&&[',','\t',';','|'].includes(source.delimiter)
  &&validBOMMapping(source.mapping)&&[',',';','space'].includes(source.referenceSeparator);
}
export async function readBOMSource(workspace,command,{signal}={}){
 signal?.throwIfAborted();
 requireSource(exact(command,['artifact',...(command&&Object.hasOwn(command,'delimiter')?['delimiter']:[])]),'sourceRequest');
 const {artifact,delimiter='auto'}=command;
 requireSource(['auto',',','\t',';','|'].includes(delimiter),'sourceSeparator');
 requireSource(artifact?.kind==='artifact'&&materialRef(artifact),'sourceFile');
 const materials=new ResearchMaterials(workspace),doc=await materials.read(artifact);
 requireSource(doc.content.size>0&&doc.content.size<=BOM_IMPORT_BYTES,'sourceSize');
 const {content}=await materials.artifact(artifact,{signal}),chunks=[];
 for await(const chunk of content.read(0,content.size-1,{signal}))chunks.push(chunk);
 let table;
 try{table=readBOMTable(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),delimiter);}
 catch(e){throw invalid(e.code==='ERR_ENCODING_INVALID_ENCODED_DATA'?bomImportError('sourceEncoding'):e);}
 return {artifact:{kind:'artifact',id:artifact.id,revision:artifact.revision},name:doc.content.name,sha256:doc.content.sha256,size:doc.content.size,table};
}
export async function verifyBOMSource(workspace,source){
 requireSource(validBOMSource(source),'sourceOriginal');
 const verified=await readBOMSource(workspace,{artifact:source.artifact,delimiter:source.delimiter});
 requireSource(['name','sha256','size'].every(key=>source[key]===verified[key]),'sourceChanged');
 try{mapBOMTable(verified.table,source.mapping,source);}
 catch(e){throw invalid(e);}
}
