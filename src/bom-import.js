import {ResearchMaterials,materialRef} from './research-materials.js';
import {AppError} from './errors.js';
import {exact,requireValue} from './modules/validation.js';
import {BOM_IMPORT_BYTES,readBOMTable,mapBOMTable,validBOMMapping} from './web/modules/bom-import-model.js';

export function validBOMSource(source){
 return exact(source,['version','artifact','sha256','size','name','delimiter','mapping','referenceSeparator'])&&source.version===1
  &&exact(source.artifact,['kind','id','revision'])&&source.artifact.kind==='artifact'&&materialRef(source.artifact)
  &&typeof source.sha256==='string'&&/^[a-f0-9]{64}$/.test(source.sha256)&&Number.isSafeInteger(source.size)&&source.size>0&&source.size<=BOM_IMPORT_BYTES
  &&typeof source.name==='string'&&source.name.length<=300&&[',','\t',';','|'].includes(source.delimiter)
  &&validBOMMapping(source.mapping)&&[',',';','space'].includes(source.referenceSeparator);
}
export async function readBOMSource(workspace,command,{signal}={}){
 signal?.throwIfAborted();
 requireValue(exact(command,['artifact',...(command&&Object.hasOwn(command,'delimiter')?['delimiter']:[])]),'BOM source request');
 const {artifact,delimiter='auto'}=command;
 requireValue(['auto',',','\t',';','|'].includes(delimiter),'BOM column separator');
 requireValue(artifact?.kind==='artifact'&&materialRef(artifact),'Choose an original BOM file');
 const materials=new ResearchMaterials(workspace),doc=await materials.read(artifact);
 requireValue(doc.content.size>0&&doc.content.size<=BOM_IMPORT_BYTES,'Import a BOM table up to 1 MiB');
 const {content}=await materials.artifact(artifact,{signal}),chunks=[];
 for await(const chunk of content.read(0,content.size-1,{signal}))chunks.push(chunk);
 let table;
 try{table=readBOMTable(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),delimiter);}
 catch(e){throw new AppError('MODULE_INVALID',[{field:e.message}]);}
 return {artifact:{kind:'artifact',id:artifact.id,revision:artifact.revision},name:doc.content.name,sha256:doc.content.sha256,size:doc.content.size,table};
}
export async function verifyBOMSource(workspace,source){
 requireValue(validBOMSource(source),'BOM original source');
 const verified=await readBOMSource(workspace,{artifact:source.artifact,delimiter:source.delimiter});
 requireValue(['name','sha256','size'].every(key=>source[key]===verified[key]),'BOM source no longer matches the original');
 try{mapBOMTable(verified.table,source.mapping,source);}
 catch(e){throw new AppError('MODULE_INVALID',[{field:e.message}]);}
}
