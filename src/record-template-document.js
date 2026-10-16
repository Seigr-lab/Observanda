// The immutable field schema and its values grow independently. Only one field
// definition/value is loaded during validation, indexing and selected editing.
import {AppError} from './errors.js';
import {validTemplate} from './web/notebook-schema.js';
import {validFields,fieldValueErrors} from './web/custom-fields.js';
import {withScratch} from './scratch-work.js';

const invalid=()=>{throw new AppError('INVALID',[{field:'record fields'}]);};
export async function recordTemplateHeader(document,{signal}={}){
 const target=await document.tree.select(document.root,['template']);if(!target)return undefined;
 const node=target.inline?{type:'inline',value:target.value}:await document.tree.node(target.revision);
 if(node.type==='inline'&&node.value===null)return null;
 const result={fields:[],values:{}};
 for await(const child of document.properties(['template'],{signal})){
  if(['fields','values'].includes(child.name))continue;
  if(Object.hasOwn(result,child.name))invalid();Object.defineProperty(result,child.name,{value:await document.tree.read(child.value),enumerable:true});
 }
 return result;
}
export async function validateRecordTemplate(document,header,{signal}={}){
 if(header===undefined||header===null)return;
 if(!validTemplate(header))invalid();
 const names=await document.tree.propertyNames(await document.reference(['template']));
 if(names.length!==6||!names.includes('fields')||!names.includes('values'))invalid();
 await withScratch(async fields=>{
  for await(const child of document.items(['template','fields'],{signal})){
   const definition=await document.tree.read(child.value);
   if(!validFields([definition])||!await fields.add(definition.key,{definition,seen:false}))invalid();
  }
  for await(const child of document.properties(['template','values'],{signal})){
   const entry=await fields.get(child.name);if(!entry||entry.seen)invalid();
   const value=await document.tree.read(child.value);
   if(fieldValueErrors([entry.definition],{[child.name]:value}).length)invalid();
   await fields.put(child.name,{...entry,seen:true});
  }
  for await(const entry of fields.items())if(!entry.seen&&fieldValueErrors([entry.definition],{}).length)invalid();
 },{signal});
}
