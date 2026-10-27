import './i18n/catalogues/pdfEditor.js';
import {revisionId} from './revision-model.js';
import {PDF_ICC_MAX_BYTES,PDF_PRINT_INTENTS,validPdfPrintCondition} from './pdf-print-condition-model.js';
import {t} from './i18n/index.js';
const tr=key=>t('pdfEditor',key),base64=bytes=>{let text='';for(let at=0;at<bytes.length;at+=32768)text+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(text);};
export function pdfPrintConditionUI({post,getDocument,prepare,changed,saved,setBusy,draw,notify,esc}){
 let upload=null,controller=null,disposed=false,label='',intent='relative-colorimetric',pending=null;
 const current=selected=>!disposed&&getDocument()===selected;
 function view(){const condition=getDocument()?.header.printCondition;return '<details data-pdf-print-condition><summary>'+esc(tr('printCondition'))+'</summary><p>'+esc(tr('printConditionHint'))+'</p><label class="field">'+esc(tr('printConditionLabel'))+'<input data-pdf-print-label maxlength="120"'+(pending?' readonly':'')+' value="'+esc(condition?.label??label)+'" placeholder="'+esc(tr('printConditionDefault'))+'"></label><label class="field">'+esc(tr('printRenderingIntent'))+'<select data-pdf-print-intent'+(pending?' disabled':'')+'>'+PDF_PRINT_INTENTS.map(value=>'<option value="'+value+'"'+((condition?.renderingIntent??intent)===value?' selected':'')+'>'+esc(tr('printIntent'+value))+'</option>').join('')+'</select></label><label class="field">'+esc(tr(condition?'printReplaceProfile':'printChooseProfile'))+'<input type="file" data-pdf-print-profile accept=".icc,.icm"'+(pending||getDocument()?.header.outputProfile==='pdfa-2u'?' disabled':'')+'></label>'+(condition?'<p>'+esc(tr('printProfileRetained'))+'</p><button class="button" type="button" data-action="module-command" data-module-id="pdf-editor" data-command="print-condition-remove">'+esc(tr('printRemoveCondition'))+'</button>':'')+(getDocument()?.header.outputProfile==='pdfa-2u'?'<p>'+esc(tr('printChooseOrdinary'))+'</p>':'')+(pending?'<p role="alert">'+esc(tr('printProfileUnconfirmed'))+'</p><button class="button" type="button" data-action="module-command" data-module-id="pdf-editor" data-command="print-condition-retry">'+esc(tr('retry'))+'</button>':'')+'</details>';}

 async function send(record,signal){
  let result;for(let attempt=0;attempt<2;attempt++)try{result=await post('print-profile-import',record.command,{signal});break;}catch(error){signal.throwIfAborted();if(!error.code&&error.name!=='AbortError')record.uncertain=true;else throw error;if(attempt===1)throw error;}
  signal.throwIfAborted();if(!current(record.selected))return;
  if(!validPdfPrintCondition(result?.printCondition)||!revisionId(result.revision)){record.uncertain=true;throw Error(t('errors','PDF_PRINT_PROFILE'));}
  record.selected.revision=result.revision;record.selected.header.printCondition=result.printCondition;pending=null;saved();
 }
 function run(selected,work,{notifyFailure=false}={}){
  controller=new AbortController();const signal=controller.signal;setBusy(true);let task;
  task=work(signal).catch(error=>{if(notifyFailure&&error.name!=='AbortError'&&current(selected))notify(error.message??String(error));throw error;}).finally(()=>{if(upload===task){upload=null;controller=null;}if(current(selected)){setBusy(false);draw();}});
  upload=task;if(notifyFailure)void task.catch(()=>{});return task;
 }
 function retry(){if(upload)return upload;if(!pending||disposed)return Promise.resolve();const record=pending;if(!current(record.selected))return Promise.reject(new DOMException('Document changed','AbortError'));return run(record.selected,signal=>send(record,signal));}
 function input(element){
  const selected=getDocument();if(!selected||disposed)return false;
  if(element.hasAttribute('data-pdf-print-label')){label=element.value;if(selected.header.printCondition){selected.header.printCondition.label=label;changed();}return true;}
  if(element.hasAttribute('data-pdf-print-intent')){intent=element.value;if(selected.header.printCondition){selected.header.printCondition.renderingIntent=intent;changed();}return true;}
  if(!element.hasAttribute('data-pdf-print-profile'))return false;const file=element.files?.[0];if(!file||upload)return true;
  if(pending){void retry().catch(error=>{if(current(selected))notify(error.message??String(error));});return true;}
  run(selected,async signal=>{
   if(!file.size||file.size>PDF_ICC_MAX_BYTES)throw Error(t('errors','PDF_PRINT_PROFILE'));await prepare();signal.throwIfAborted();if(!current(selected))throw new DOMException('Document changed','AbortError');
   const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();const record={selected,uncertain:false,command:{id:selected.header.id,commandId:crypto.randomUUID(),expectedRevision:selected.revision,bytes:base64(bytes),label:selected.header.printCondition?.label??(label.trim()||tr('printConditionDefault')),renderingIntent:selected.header.printCondition?.renderingIntent??intent}};
   try{await send(record,signal);}catch(error){if(record.uncertain&&current(selected))pending=record;throw error;}
  },{notifyFailure:true});return true;
 }

 function action(name){if(name!=='print-condition-remove')return false;const selected=getDocument();if(selected?.header.printCondition){delete selected.header.printCondition;changed();draw();}return true;}
 return {view,input,action,retry,isBusy:()=>upload!==null,hasPending:()=>pending!==null,async whenIdle(){if(upload)await upload.catch(()=>{});if(pending)await retry();},async discard(){controller?.abort();if(upload)await upload.catch(()=>{});pending=null;},dispose(){disposed=true;controller?.abort();}};
}
