import {t} from './i18n/index.js';
// Compare a preparation input's declared hash with the original it references,
// using the evidence checksum route. The comparison reads every byte of the
// retained original and never changes the record or the original.
const text=key=>t('attempts',key);
export const checkableInput=input=>!!input?.reference&&!input.reference.withheld&&input.reference.kind==='artifact'&&['sha256','sha512'].includes(input.algorithm)&&/^[0-9a-f]+$/i.test(input.hash??'');
export function attemptInputChecks({api,esc,render}){
 const results=new Map();let controller=null;
 const key=input=>input.id+':'+input.hash.toLowerCase()+':'+input.reference.id+':'+input.reference.revision;
 function view(input){
  if(!checkableInput(input))return '';
  const result=results.get(key(input)),status=!result?'':result==='checking'?'<span role="status">'+esc(text('inputChecking'))+'</span>':result==='match'?'<strong class="attempt-input-match" role="status">'+esc(text('inputMatch'))+'</strong>':result==='mismatch'?'<strong class="attempt-input-mismatch" role="alert">'+esc(text('inputMismatch'))+'</strong>':'<span role="alert">'+esc(text('inputCheckFailed'))+'</span>';
  return '<div class="inline-actions" data-attempt-input-check="'+esc(input.id)+'"><button type="button" class="button" data-action="content-attempt-input-check" data-input="'+esc(JSON.stringify({id:input.id,algorithm:input.algorithm,hash:input.hash,reference:{kind:'artifact',id:input.reference.id,revision:input.reference.revision,...(input.reference.workspaceId?{workspaceId:input.reference.workspaceId}:{})}}))+'"'+(result==='checking'?' disabled':'')+'>'+esc(text('inputCheck'))+'</button>'+status+'</div>';
 }
 async function action(control){
  if(control.dataset.action!=='content-attempt-input-check')return false;
  let input;try{input=JSON.parse(control.dataset.input);}catch{return true;}
  if(!checkableInput(input))return true;
  const id=key(input);controller?.abort();const current=new AbortController();controller=current;results.set(id,'checking');render();
  try{
   const result=await api('/api/research/materials/artifact-digest',{ref:input.reference,algorithm:input.algorithm,expected:input.hash},{adopt:false,signal:current.signal,onProgress:()=>{}});
   results.set(id,result?.matches===true?'match':result?.matches===false?'mismatch':'failed');
  }catch{if(!current.signal.aborted)results.set(id,'failed');else results.delete(id);}
  finally{if(controller===current)controller=null;render();}
  return true;
 }
 return {view,action,clear(){controller?.abort();controller=null;results.clear();}};
}
