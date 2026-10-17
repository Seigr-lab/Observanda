// The immutable field schema and its values grow independently. Selected reads
// and validation retain bounded field metadata while choices stream separately.
import {AppError} from './errors.js';
import {validTemplate} from './web/notebook-schema.js';
import {validFields,fieldChoiceValid,fieldValueErrors} from './web/custom-fields.js';
import {validRecordValueField} from './web/record-value-model.js';
import {revisionId} from './web/revision-model.js';
import {jsonFitsBytes} from './web/json-chunks.js';
import {withScratch} from './scratch-work.js';

const invalid=()=>{throw new AppError('INVALID',[{field:'record fields'}]);};
// Every admitted scalar fits this bound, including a 10,000-character text
// value encoded with JSON escapes. Containers and oversized strings stop early.
async function boundedValue(document,revision,{signal}={}){
 let text='';for await(const chunk of document.tree.json(revision,{signal})){if(text.length+chunk.length>65536)invalid();text+=chunk;}
 return JSON.parse(text);
}
async function definitionAt(document,path,schemaRevision,{signal}={}){
 const header={};let choices=false;
 for await(const child of document.properties(path,{signal})){
  if(!['key','label','type','unit','required','choices','numeric'].includes(child.name)||Object.hasOwn(header,child.name))invalid();
  if(child.name==='choices'){if(choices)invalid();choices=true;continue;}
  Object.defineProperty(header,child.name,{value:await boundedValue(document,child.value,{signal}),enumerable:true});
 }
 if(!choices||!validFields([{...header,choices:header.type==='select'?['choice']:[]}]))invalid();
 const choiceCount=await document.tree.arrayLength(document.root,[...path,'choices']);
 if(header.type==='select'&&!choiceCount)invalid();
 return {header,path,schemaRevision,choiceCount};
}
async function selectedDefinition(document,field,{signal}={}){
 if(!validRecordValueField(field)||!field.startsWith('template:'))invalid();
 const key=field.slice(9),present=await document.tree.select(document.root,['template','fields']);
 if(present)for await(const item of document.items(['template','fields'],{signal})){
  const selected=await document.tree.select(item.value,['key']);
  if(selected&&(selected.inline?selected.value:await boundedValue(document,selected.revision,{signal}))===key)return definitionAt(document,['template','fields',String(item.index)],item.value,{signal});
 }
 throw new AppError('MISSING');
}
export async function recordTemplateDefinition(document,field,{signal}={}){
 const {header,schemaRevision,choiceCount}=await selectedDefinition(document,field,{signal});
 return {...header,schemaRevision,choiceCount};
}
export async function recordTemplateFieldWindow(document,{offset=0,signal}={}){
 if(!Number.isSafeInteger(offset)||offset<0)invalid();
 const total=await document.tree.arrayLength(document.root,['template','fields']);offset=Math.min(offset,Math.max(0,total-1));const values=[];
 for await(const item of document.items(['template','fields'],{offset,limit:4,signal})){
  const {header,schemaRevision,choiceCount}=await definitionAt(document,['template','fields',String(item.index)],item.value,{signal});values.push({...header,schemaRevision,choiceCount});
 }
 return {offset,total,values};
}
// Keep the old joined search spelling and small-string encoding. Larger text
// uses its original lowered 2048-unit vocabulary windows; choices are omitted.
export async function recordTemplateSearchText(document,{signal}={}){
 async function* parts(){
  const template=await document.tree.select(document.root,['template']);
  if(!template||(template.inline?template.value===null:(await document.tree.node(template.revision)).value===null)){yield '';return;}
  yield (await document.field(['template','label'],{signal})).value??'';
  for await(const child of document.properties(['template','values'],{signal}))yield await boundedValue(document,child.value,{signal});
 }
 const items=parts()[Symbol.asyncIterator]();let prefix='',first=true;
 try{
  for(;;){
   const next=await items.next();if(next.done)return prefix;
   prefix+=(first?'':' ')+String(next.value??'');first=false;
   if(!jsonFitsBytes(prefix.toLocaleLowerCase(),8191,{pretty:true}))return (async function*(){
    let pending=prefix.toLocaleLowerCase();
    try{for(;;){
     while(pending.length>=2048){signal?.throwIfAborted();yield pending.slice(0,2048);pending=pending.slice(2048);}
     const next=await items.next();if(next.done){if(pending)yield pending;return;}
     pending+=(' '+String(next.value??'')).toLocaleLowerCase();
    }}finally{await items.return?.();}
   })();
  }
 }catch(error){await items.return?.();throw error;}
}
export async function recordTemplateChoices(document,field,{schemaRevision,offset=0,query='',signal}={}){
 if(!revisionId(schemaRevision)||!Number.isSafeInteger(offset)||offset<0||typeof query!=='string'||query.length>160)invalid();
 const selected=await selectedDefinition(document,field,{signal});
 if(selected.schemaRevision!==schemaRevision)throw new AppError('RECORD_CHANGED');
 const {path,choiceCount}=selected,items=[],needle=query.trim().toLowerCase();let total=0;
 for await(const child of document.items([...path,'choices'],{offset:needle?0:offset,limit:needle?Infinity:32,signal})){
  const value=await boundedValue(document,child.value,{signal});if(!fieldChoiceValid(value))invalid();
  if(needle&&!value.toLowerCase().includes(needle))continue;
  if(!needle||total>=offset&&items.length<32)items.push(value);total++;
 }
 if(!needle)total=choiceCount;
 return {schemaRevision,offset,total,next:offset+items.length<total?offset+items.length:null,items};
}
export async function recordTemplateHeader(document,{signal}={}){
 const target=await document.tree.select(document.root,['template']);if(!target)return undefined;
 const node=target.inline?{type:'inline',value:target.value}:await document.tree.node(target.revision);
 if(node.type==='inline'&&node.value===null)return null;
 const result={fields:[],values:{}};
 for await(const child of document.properties(['template'],{signal})){
  if(['fields','values'].includes(child.name))continue;
  if(!['id','profileId','label','description'].includes(child.name)||Object.hasOwn(result,child.name))invalid();Object.defineProperty(result,child.name,{value:await boundedValue(document,child.value,{signal}),enumerable:true});
 }
 return result;
}
export async function validateRecordTemplate(document,header,{signal,draft=false}={}){
 if(header===undefined||header===null)return;
 if(!validTemplate(header))invalid();
 const names=await document.tree.propertyNames(await document.reference(['template']));
 if(names.length!==6||!names.includes('fields')||!names.includes('values'))invalid();
 await withScratch(async identities=>{
  for await(const child of document.items(['template','fields'],{signal})){
   const {header:definition,path}=await definitionAt(document,['template','fields',String(child.index)],child.value,{signal}),key=definition.key;
   if(!await identities.add('field:'+key,{kind:'field',definition,seen:false}))invalid();
   for await(const choice of document.items([...path,'choices'],{signal})){
    const text=await boundedValue(document,choice.value,{signal});
    if(!fieldChoiceValid(text)||!await identities.add(JSON.stringify(['choice',key,text]),true))invalid();
   }
  }
  for await(const child of document.properties(['template','values'],{signal})){
   const entry=await identities.get('field:'+child.name);if(!entry||entry.seen)invalid();
   const {definition}=entry,value=await boundedValue(document,child.value,{signal}),empty=value===undefined||value===null||value==='';
   const matched=definition.type==='select'&&!empty&&await identities.has(JSON.stringify(['choice',definition.key,value]));
   if(definition.type==='select'&&!empty&&!matched||fieldValueErrors([{...definition,choices:definition.type==='select'?[matched?value:'choice']:[]}],{[child.name]:value},{draft}).length)invalid();
   await identities.put('field:'+child.name,{...entry,seen:true});
  }
  for await(const entry of identities.items())if(entry?.kind==='field'&&!entry.seen&&fieldValueErrors([{...entry.definition,choices:entry.definition.type==='select'?['choice']:[]}],{},{draft}).length)invalid();
 },{signal});
}
