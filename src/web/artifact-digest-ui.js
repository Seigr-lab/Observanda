import './i18n/catalogues/artifactDigests.js';
import {t,language} from './i18n/index.js';
import {ARTIFACT_DIGESTS,artifactDigestNames,validExpectedDigest} from './artifact-digest-model.js';

const text=(key,values)=>t('artifactDigests',key,values);
const label={sha256:'SHA-256',sha384:'SHA-384',sha512:'SHA-512','sha3-256':'SHA3-256','sha3-512':'SHA3-512',blake2b512:'BLAKE2b-512',sha1:'SHA-1',md5:'MD5'};
// Verify a retained original against a published checksum. The server reads
// every byte once and recomputes the retained SHA-256 in the same pass.
export function artifactDigestUI({call,esc}){
 let run=null;
 const host=()=>document.querySelector('[data-artifact-digest]');
 function controls(ref){
  return '<details class="material-more" data-artifact-digest data-ref="'+esc(JSON.stringify(ref))+'"><summary>'+esc(text('heading'))+'</summary><p class="muted">'+esc(text('help'))+'</p>'+
   '<label>'+esc(text('algorithm'))+'<select data-digest-algorithm>'+artifactDigestNames.map(name=>'<option value="'+name+'"'+(name==='sha512'?' selected':'')+'>'+esc(label[name]+(ARTIFACT_DIGESTS[name].weak?' · '+text('weak'):''))+'</option>').join('')+'</select></label>'+
   '<label>'+esc(text('expected'))+'<textarea data-digest-expected rows="2" spellcheck="false" autocomplete="off" maxlength="4096"></textarea></label><p class="muted">'+esc(text('expectedHelp'))+'</p>'+
   '<div class="inline-actions"><button type="button" class="button" data-action="material-digest-run">'+esc(text('run'))+'</button><button type="button" class="button" data-action="material-digest-cancel" hidden>'+esc(text('cancel'))+'</button></div>'+
   '<progress data-digest-meter hidden aria-label="'+esc(text('heading'))+'"></progress><div data-digest-result role="status" aria-live="polite"></div></details>';
 }
 function show(node,markup){const result=node.querySelector('[data-digest-result]');if(result)result.innerHTML=markup;}
 function busy(node,running){node.querySelector('[data-digest-meter]').hidden=!running;node.querySelector('[data-action="material-digest-cancel"]').hidden=!running;node.querySelector('[data-action="material-digest-run"]').disabled=running;}
 async function start(node){
  const ref=JSON.parse(node.dataset.ref),algorithm=node.querySelector('[data-digest-algorithm]').value,raw=node.querySelector('[data-digest-expected]').value;
  if(raw.trim()&&!validExpectedDigest(algorithm,raw)){show(node,'<p role="alert">'+esc(text('expectedInvalid',{algorithm:label[algorithm],length:ARTIFACT_DIGESTS[algorithm].hex}))+'</p>');return;}
  run?.controller.abort();const current={controller:new AbortController(),node};run=current;busy(node,true);show(node,'<p>'+esc(text('reading'))+'</p>');
  const meter=node.querySelector('[data-digest-meter]');meter.removeAttribute('value');
  try{
   const result=await call('artifact-digest',{ref,algorithm,...(raw.trim()?{expected:raw}:{})},{adopt:false,signal:current.controller.signal,onProgress:value=>{
    if(run!==current||value.stage!=='checksum-file'||!Number.isSafeInteger(value.completed)||!Number.isSafeInteger(value.total)||value.total<=0)return;
    meter.max=value.total;meter.value=value.completed;
    show(node,'<p>'+esc(text('progress',{done:value.completed.toLocaleString(language()),total:value.total.toLocaleString(language())}))+'</p>');
   }});
   if(run!==current||!node.isConnected)return;
   if(result?.algorithm!==algorithm||typeof result.digest!=='string'||result.digest.length!==ARTIFACT_DIGESTS[algorithm].hex)throw Error(text('invalid'));
   const verdict=result.matches===null?'<p>'+esc(text('computed'))+'</p>':result.matches?'<p class="material-digest-match"><strong>'+esc(text('match'))+'</strong></p>':'<p role="alert" class="material-digest-mismatch"><strong>'+esc(text('mismatch'))+'</strong></p>';
   show(node,verdict+'<dl><dt>'+esc(label[algorithm])+'</dt><dd class="material-hash"><code>'+esc(result.digest)+'</code></dd>'+(result.expected!==null?'<dt>'+esc(text('expectedValue'))+'</dt><dd class="material-hash"><code>'+esc(result.expected)+'</code></dd>':'')+'<dt>'+esc(text('retained'))+'</dt><dd>'+esc(text('retainedIntact',{bytes:result.size.toLocaleString(language())}))+'</dd></dl>'+(ARTIFACT_DIGESTS[algorithm].weak?'<p class="muted">'+esc(text('weakHelp'))+'</p>':''));
  }catch(error){
   if(run!==current||!node.isConnected)return;
   show(node,'<p role="alert">'+esc(current.controller.signal.aborted?text('cancelled'):error.code==='MATERIAL_MISSING'?text('damaged'):error.message||text('invalid'))+'</p>');
  }finally{if(run===current){run=null;if(node.isConnected)busy(node,false);}}
 }
 async function action(act){
  const node=host();if(!node)return true;
  if(act==='digest-cancel'){run?.controller.abort();return true;}
  if(act==='digest-run')await start(node);
  return true;
 }
 function stop(){run?.controller.abort();run=null;}
 return {controls,action,stop};
}
