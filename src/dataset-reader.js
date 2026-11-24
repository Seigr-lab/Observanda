// Dataset mapping validation and bounded UTF-8 decoding for retained evidence. Mapping is data, never code.
import {AppError} from './errors.js';
import {nestedMapping} from './web/dataset-preparation-model.js';
export const DATASET_LIMITS=Object.freeze({chunkBytes:16384,rowChars:262144,columns:256,depth:64,keys:4096,pageRows:256,pageBytes:1048576});
const fail=()=>{throw new AppError('MATERIAL_TABLE');};
const pointer=value=>{
 if(typeof value!=='string'||value.length>2048||value!==''&&!value.startsWith('/')||/~(?![01])/u.test(value))fail();
 return value===''?[]:value.slice(1).split('/').map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'));
};
export function datasetMapping(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail();
 const format=input.format??'delimited';
 if(format==='json-nested'){try{return nestedMapping(input);}catch{fail();}}
 if(format==='delimited'){
  const delimiter=input.delimiter??'auto',header=input.header??true;
  if(!['auto',',','\t',';','|'].includes(delimiter)||typeof header!=='boolean')fail();
  return {format,delimiter,header};
 }
 if(!['json','jsonl'].includes(format)||input.fields!=='all'&&(!Array.isArray(input.fields)||!input.fields.length))fail();
 const rowsPath=format==='json'?(input.rowsPath??''):'';
 pointer(rowsPath);
 if(input.fields==='all')return {format,rowsPath,fields:'all'};
 const fields=input.fields.map(field=>{
  if(!field||typeof field.name!=='string'||!field.name.trim()||field.name.length>200)fail();
  pointer(field.path);return {name:field.name.trim(),path:field.path};
 });
 if(new Set(fields.map(f=>f.name)).size!==fields.length||new Set(fields.map(f=>f.path)).size!==fields.length)fail();
 return {format,rowsPath,fields};
}
export async function* datasetTexts(source,{signal,progress=async()=>{},size=0,keepBOM=false}={}){
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:keepBOM});let done=0;
 for await(const bytes of source){
  for(let i=0;i<bytes.length;i+=DATASET_LIMITS.chunkBytes){
   signal?.throwIfAborted();const part=bytes.subarray(i,i+DATASET_LIMITS.chunkBytes);let text;
   try{text=decoder.decode(part,{stream:true});}catch{fail();}
   done+=part.length;yield text;
   await progress({stage:'reading dataset',done,total:size||done,unit:'bytes'});
  }
 }
 try{const tail=decoder.decode();if(tail)yield tail;}catch{fail();}
 signal?.throwIfAborted();
}
