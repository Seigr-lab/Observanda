import {AppError} from '../errors.js';
import {sourceChunks,checkSourceSignal} from './source-files.js';
import {selectorKey,selectorLimits} from './selector-contract.js';
import {verifyJSONSelectors} from './json-selectors.js';
import {verifyHTMLSelectors} from './html-selectors.js';

export async function verifySourceSelectors(root,name,known,selectors,{signal}={}){
 const distinct=[...new Map(selectors.map(s=>[selectorKey(s),s])).values()],results=new Map();
 if(distinct.length>selectorLimits.perFile)throw new AppError('INVENTORY_LIMIT');
 for(const kind of ['whole','bytes','json-pointer','anchor']){
  const group=distinct.filter(s=>s.kind===kind);if(!group.length)continue;
  if(kind==='whole'||kind==='bytes'){
   for(const s of group)results.set(selectorKey(s),{status:'verified'});continue;
  }
  let verified;
  try{
   if(kind==='anchor'&&known.size>selectorLimits.htmlBytes)throw Object.assign(new Error(),{selectorCode:'selector-limit'});
   async function* texts(){
    const decoder=new TextDecoder('utf-8',{fatal:true});
    for await(const bytes of sourceChunks(root,name,known,{signal}))yield decoder.decode(bytes,{stream:true});
    const tail=decoder.decode();if(tail)yield tail;
   }
   verified=await (kind==='anchor'?verifyHTMLSelectors:verifyJSONSelectors)(texts(),group,{signal});
  }catch(error){
   checkSourceSignal(signal);
   if(error instanceof AppError||error.code&&error.code!=='ERR_ENCODING_INVALID_ENCODED_DATA')throw error;
   verified=group.map(()=>({status:'blocked',code:error.selectorCode??'selector-format'}));
  }
  group.forEach((s,i)=>results.set(selectorKey(s),verified[i]));
 }
 return results;
}
