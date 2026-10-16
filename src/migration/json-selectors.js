import {Readable} from 'node:stream';
import parser from 'stream-json/parser.js';
import {pointerParts,selectorLimits} from './selector-contract.js';
import {checkSourceSignal} from './source-files.js';

// Only requested paths and bounded parser frames are retained. Number/string
// values are streamed past without conversion, even beyond JavaScript precision.
export async function verifyJSONSelectors(chunks,selectors,{signal}={}){
 const node=()=>({children:new Map(),matches:0,ambiguous:false}),root=node(),targets=[];
 for(const selector of selectors){
  let at=root;for(const part of pointerParts(selector.value)){if(!at.children.has(part))at.children.set(part,node());at=at.children.get(part);}targets.push(at);
 }
 const stack=[];let key=null,inKey=false,scalar=false;
 const next=()=>{const parent=stack.at(-1);return parent?parent.node?.children.get(parent.kind==='array'?String(parent.index):parent.key):root;};
 const begin=()=>{const at=next();if(at)at.matches++;return at;};
 const finish=()=>{const parent=stack.at(-1);if(parent?.kind==='array')parent.index++;};
 const ambiguous=at=>{if(!at||at.ambiguous)return;const pending=[at];while(pending.length){const n=pending.pop();n.ambiguous=true;pending.push(...n.children.values());}};
 const stream=Readable.from(chunks).compose(parser.asStream({packValues:false}));
 try{
  for await(const {name,value} of stream){
   checkSourceSignal(signal);
   if(name==='startKey'){inKey=true;key='';continue;}
   if(name==='stringChunk'||name==='numberChunk'){
    if(inKey&&key!==null){key+=value;if(key.length>2048)key=null;}continue;
   }
   if(name==='endKey'){
    inKey=false;const parent=stack.at(-1);parent.key=key;
    if(parent.node?.children.has(key)){if(parent.seen.has(key))ambiguous(parent.node.children.get(key));parent.seen.add(key);}continue;
   }
   if(name==='startObject'||name==='startArray'){
    if(stack.length>=selectorLimits.jsonDepth)throw Object.assign(new Error(),{selectorCode:'selector-limit'});
    stack.push({kind:name==='startArray'?'array':'object',node:begin(),index:0,key:null,seen:new Set()});continue;
   }
   if(name==='endObject'||name==='endArray'){stack.pop();finish();continue;}
   if(name==='startString'||name==='startNumber'){begin();scalar=true;continue;}
   if(name==='endString'||name==='endNumber'){scalar=false;finish();continue;}
   if(['trueValue','falseValue','nullValue'].includes(name)){begin();finish();}
  }
  if(stack.length||scalar)throw new Error('Incomplete JSON');
  return targets.map(at=>at.ambiguous||at.matches>1?{status:'blocked',code:'selector-ambiguous'}:at.matches===1?{status:'verified'}:{status:'blocked',code:'selector-missing'});
 }finally{stream.destroy();}
}
