// The transport keeps its historical JSON shape. Template containers are
// inspected and retained one bounded definition/choice/value at a time.
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {validTemplate} from './web/notebook-schema.js';
import {validFields,fieldChoiceValid,fieldValueErrors} from './web/custom-fields.js';
import {sameJSONData} from './web/json-data-equality.js';
import {RecordContainerBuilder} from './record-tree-values.js';
const invalid=()=>{throw new AppError('INVALID');},damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const equal=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);

export async function inspectDraftTemplate(first,parts,consume,{signal}={}){
 return withScratch(fields=>withScratch(async choices=>{
  const header={fields:[],values:{}};let current=null,fieldCount=0,hasFields=false,hasValues=false;
  const accept=async part=>{
   signal?.throwIfAborted();if(part.kind!=='template')invalid();const {path,type,value}=part;
   if(type==='array'&&path.length===1&&path[0]==='fields'){if(hasFields)invalid();hasFields=true;}
   else if(type==='object'&&path.length===1&&path[0]==='values'){if(hasValues)invalid();hasValues=true;}
   else if(type==='object'&&path.length===2&&path[0]==='fields'){
    if(current||Number(path[1])!==fieldCount)invalid();current={index:fieldCount,header:{},choices:null};
   }else if(type==='array'&&path.length===3){if(!current||current.choices!==null)invalid();current.choices=0;}
   else if(type==='value'){
    if(path.length===1)Object.defineProperty(header,path[0],{value,enumerable:true});
    else if(path[0]==='values'){
     if(!await fields.add('value:'+path[1],{kind:'value',key:path[1],value}))invalid();
    }else if(path.length===3){if(!current)invalid();Object.defineProperty(current.header,path[2],{value,enumerable:true});}
    else if(path.length===4){
     if(!current||current.choices!==Number(path[3])||!fieldChoiceValid(value)||!await choices.add(JSON.stringify([current.index,value]),true))invalid();current.choices++;
    }else invalid();
   }else if(type==='end'&&path.length===2&&path[0]==='fields'){
    if(!current||current.choices===null||current.header.type==='select'&&!current.choices||!validFields([{...current.header,choices:current.header.type==='select'?['choice']:[]}]))invalid();
    if(!await fields.add('field:'+current.header.key,{kind:'field',...current}))invalid();current=null;fieldCount++;
   }
   await consume?.(part,{templateScratch:choices});
  };
  await accept(first);
  for(;;){
   const next=await parts.next();if(next.done)invalid();const part=next.value;await accept(part);
   if(part.type!=='end'||part.path.length)continue;
   if(current||!hasFields||!hasValues||!validTemplate(header))invalid();
   for await(const item of fields.items()){
    if(item.kind==='value'){if(!await fields.has('field:'+item.key))invalid();continue;}
    const definition=item.header,saved=await fields.get('value:'+definition.key),value=saved?.value,empty=value===undefined||value===null||value==='';
    const matched=definition.type==='select'&&!empty&&await choices.has(JSON.stringify([item.index,value]));
    if(definition.type==='select'&&!empty&&!matched||fieldValueErrors([{...definition,choices:definition.type==='select'?[matched?value:'choice']:[]}],saved?{[definition.key]:value}:{},{draft:true}).length)invalid();
   }
   return;
  }
  invalid();
 },{signal}),{signal});
}
export class DraftTemplateBuilder{
 constructor(blocks){this.blocks=blocks;this.tree=blocks.tree();this.stack=[];}
 async accept(part){
  const {path,type,value}=part,parent=this.stack.at(-1);
  if(type==='object'||type==='array'){this.stack.push({path,builder:new RecordContainerBuilder(this.blocks,type)});return null;}
  let reference;
  if(type==='end'){if(!parent||!equal(parent.path,path))invalid();reference=await parent.builder.finish();this.stack.pop();}
  else if(type==='value')reference=await this.tree.retain(value);else invalid();
  const owner=this.stack.at(-1);if(!owner){if(path.length)invalid();return reference;}
  await owner.builder.add({name:path.at(-1),value:reference});return null;
 }
}
export class DraftTemplateComparison{
 constructor(document,{signal,scratch}={}){this.document=document;this.signal=signal;this.scratch=scratch;this.indexedValues=false;this.stack=[];}
 async accept(part){
  const {path,type,value}=part,parent=this.stack.at(-1),full=['template',...path],document=this.document;
  if(type==='end'){if(!parent||!equal(parent.path,path)||parent.count!==parent.total)damaged();this.stack.pop();return;}
  if(parent)parent.count++;
  if(type==='value'){
   const revision=path[0]==='values'&&this.indexedValues?(await this.scratch.get('template-native-value:'+path[1]))?.revision:await document.reference(full,{signal:this.signal});if(!revision)damaged();let text='';
   for await(const chunk of document.tree.json(revision,{signal:this.signal})){if(text.length+chunk.length>65536)damaged();text+=chunk;}
   if(!sameJSONData(JSON.parse(text),value))damaged();return;
  }
  const selected=await document.tree.select(document.root,full);if(!selected)damaged();
  const node=selected.inline?{type:'inline',value:selected.value}:await document.tree.node(selected.revision);let total;
  if(node.type==='inline'){
   if(type==='array'?!Array.isArray(node.value):!node.value||typeof node.value!=='object'||Array.isArray(node.value))damaged();total=type==='array'?node.value.length:Object.keys(node.value).length;
  }else{if(node.type!==type)damaged();total=node.root?.count??0;}
  if(path.length===1&&path[0]==='values'&&node.type==='object'){
   if(!this.scratch)damaged();this.indexedValues=true;
   for await(const child of document.properties(full,{signal:this.signal}))if(!await this.scratch.add('template-native-value:'+child.name,{revision:child.value}))damaged();
  }
  this.stack.push({path,total,count:0});
 }
}
