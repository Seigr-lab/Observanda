import {validGraphAddress} from './web/dataset-calculation-graph-model.js';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {revisionId} from './web/revision-model.js';
export const DATASET_TEXT_CHARS=16384;
export const DATASET_INLINE_CHARS=4096;
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
export const datasetCellReference=value=>value&&typeof value==='object'&&!Array.isArray(value)&&value.format==='dataset-cell'&&value.version===1&&Number.isSafeInteger(value.characters)&&value.characters>DATASET_INLINE_CHARS&&revisionId(value.sha256)&&value.parts?.kind==='cell-text';
export function validateDatasetCell(materials,cell){
 if(!cell||!['string','number','boolean','null','absent','object','array'].includes(cell.kind)||cell.pointer!==undefined&&cell.pointer!==null&&(typeof cell.pointer!=='string'||cell.pointer.length>2048))fail();
 if(typeof cell.value==='string'){if(cell.value.length>DATASET_TEXT_CHARS)fail();}
 else{if(!datasetCellReference(cell.value))fail();materials.sequences.validate(cell.value.parts);if(cell.value.parts.count!==Math.ceil(cell.value.characters/DATASET_TEXT_CHARS))fail();}
 if(cell.lineage!==undefined){if(cell.lineage?.version!==1||!validGraphAddress(cell.lineage.node)||cell.lineage.leaves?.kind!=='calculation-lineage')fail();materials.sequences.validate(cell.lineage.leaves);}
 if(['absent','null'].includes(cell.kind)&&cell.value!=='')fail();return cell;
}
export async function retainDatasetCell(materials,cell,save){
 if(datasetCellReference(cell.value))return validateDatasetCell(materials,{...cell,read:undefined});
 const chunks=cell.read?cell.read():[cell.value??''];let text='',count=0,parts=null;const hash=createHash('sha256');
 for await(const value of chunks){if(typeof value!=='string')fail();count+=value.length;if(!Number.isSafeInteger(count))fail();hash.update(Buffer.from(value,'utf16le'));
  text+=value;while(text.length>=DATASET_TEXT_CHARS){parts??=materials.sequences.builder('cell-text',save);await parts.append(text.slice(0,DATASET_TEXT_CHARS));text=text.slice(DATASET_TEXT_CHARS);}
 }
 let value=text;
 if(parts||count>DATASET_INLINE_CHARS){parts??=materials.sequences.builder('cell-text',save);if(text)await parts.append(text);value={format:'dataset-cell',version:1,characters:count,sha256:hash.digest('hex'),parts:await parts.finish()};}
 return validateDatasetCell(materials,{kind:cell.kind??'string',value,...(cell.pointer!==undefined?{pointer:cell.pointer}:{}),...(cell.sources?{sources:cell.sources}:{}),...(cell.lineage?{lineage:cell.lineage}:{})});
}
export async function readDatasetCell(materials,value,{offset=0,limit=4096,signal}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>DATASET_TEXT_CHARS)throw new AppError('INVALID');
 if(typeof value==='string'){if(offset>value.length)throw new AppError('INVALID');return {text:value.slice(offset,offset+limit),offset,total:value.length,next:offset+limit<value.length?offset+limit:null,previous:offset?Math.max(0,offset-limit):null};}
 if(!datasetCellReference(value))fail();materials.sequences.validate(value.parts);if(offset>value.characters||value.parts.count!==Math.ceil(value.characters/DATASET_TEXT_CHARS))fail();
 let text='';for(let at=offset;at<Math.min(value.characters,offset+limit);){signal?.throwIfAborted();const index=Math.floor(at/DATASET_TEXT_CHARS),chunk=await materials.sequences.item(value.parts,index);if(typeof chunk!=='string'||chunk.length!==Math.min(DATASET_TEXT_CHARS,value.characters-index*DATASET_TEXT_CHARS))fail();const part=chunk.slice(at%DATASET_TEXT_CHARS,at%DATASET_TEXT_CHARS+Math.min(offset+limit-at,value.characters-at));text+=part;at+=part.length;}
 return {text,offset,total:value.characters,next:offset+text.length<value.characters?offset+text.length:null,previous:offset?Math.max(0,offset-limit):null};
}
export async function verifyDatasetCell(materials,cell,{signal}={}){
 validateDatasetCell(materials,cell);if(typeof cell.value==='string')return;
 const hash=createHash('sha256');let offset=0;
 do{const result=await readDatasetCell(materials,cell.value,{offset,limit:DATASET_TEXT_CHARS,signal});hash.update(Buffer.from(result.text,'utf16le'));offset=result.next;}while(offset!==null);
 if(hash.digest('hex')!==cell.value.sha256)fail();
}
