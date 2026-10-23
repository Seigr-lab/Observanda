// A selected original JSON value is rendered into a bounded inspection window.
// Numbers retain parser spellings; no complete selected value enters memory.
import {AppError} from './errors.js';
import {datasetJSONTokens} from './dataset-json-tokens.js';
import {datasetTexts,DATASET_LIMITS} from './dataset-reader.js';
import {jsonPointerParts} from './web/dataset-preparation-model.js';
import {withScratch} from './scratch-work.js';
const fail=()=>{throw new AppError('MEASUREMENT_INVALID');};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export async function inspectJSONValue(chunks,pointer,{offset=0,limit=4096,signal}={}){
 const target=jsonPointerParts(pointer);if(!target||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>16384)fail();
 return withScratch(async work=>{
  const stack=[];let active=false,found=false,text='',total=0,pending='';
  const append=value=>{const end=total+value.length;if(!Number.isSafeInteger(end))fail();if(end>offset&&total<offset+limit)text+=value.slice(Math.max(0,offset-total),Math.min(value.length,offset+limit-total));total=end;};
  const prefix=token=>{const parent=stack.at(-1);if(!parent)return;if(parent.used)append(',');parent.used=true;if(parent.type==='object')append(JSON.stringify(token.path.at(-1))+':');};
  for await(const token of datasetJSONTokens(datasetTexts(chunks,{signal}),()=>true,DATASET_LIMITS,{signal,chunked:true,work})){
   const start=token.event==='begin'||token.event==='scalar-start'||token.event==='value'&&!token.chunked;
   if(start&&!active&&same(token.path,target)){if(found)fail();active=true;found=true;}
   if(!active)continue;
   if(token.event==='begin'){prefix(token);append(token.type==='array'?'[':'{');stack.push({type:token.type,used:false});}
   else if(token.event==='scalar-start'){prefix(token);pending='';if(token.kind==='string')append('"');}
   else if(token.event==='scalar-chunk'){
    if(token.kind==='string'){let value=pending+token.value;pending='';if(value.length&&/[\uD800-\uDBFF]/.test(value.at(-1))){pending=value.at(-1);value=value.slice(0,-1);}append(JSON.stringify(value).slice(1,-1));}else append(token.value);
   }else if(token.event==='value'){
    if(token.chunked){if(token.kind==='string'){if(pending)append(JSON.stringify(pending).slice(1,-1));pending='';append('"');}}
    else{prefix(token);append(token.kind==='null'?'null':token.value);}
   }else if(token.event==='end'){const parent=stack.pop();if(!parent)fail();append(parent.type==='array'?']':'}');}
   if((token.event==='end'||token.event==='value')&&same(token.path,target))active=false;
  }
  if(!found||active||offset>total)fail();return {text,offset,total,next:offset+text.length<total?offset+text.length:null,previous:offset?Math.max(0,offset-limit):null};
 },{signal});
}
