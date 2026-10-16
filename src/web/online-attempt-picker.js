import {t} from './i18n/index.js';
const tr=key=>t('online',key);

// Shared-source discovery is scoped by the host. Selecting a reference pins
// the displayed revision before it can enter a structured fact.
export function onlineAttemptPicker({host,record,remote,esc,recordsOnly,onChoose,onCancel}){
 let disposed=false,busy=false,next=null,materialNext=null,records=new Map(),materials=new Map();
 const button=(key,action)=>'<button type="button" class="button" data-source-action="'+action+'">'+esc(tr(key))+'</button>';
 host.innerHTML='<label class="field">'+esc(tr('linkSearch'))+'<input data-source-query maxlength="180"></label>'+button('linkSearchButton','search')+'<label class="field">'+esc(tr('linkTarget'))+'<select data-source-record aria-label="'+esc(tr('linkTarget'))+'"></select></label>'+button('linkMore','more')+(!recordsOnly?'<label class="field">'+esc(tr('attemptMaterial'))+'<select data-source-material aria-label="'+esc(tr('attemptMaterial'))+'"></select></label>':'')+'<p data-source-status role="status"></p><div class="module-actions">'+button('attemptUseReference','use')+button('linkCancel','cancel')+'</div>';
 const status=host.querySelector('[data-source-status]'),select=host.querySelector('[data-source-record]');
 if(!recordsOnly)host.querySelector('[data-source-material]').closest('label').insertAdjacentHTML('afterend',button('attemptMoreMaterials','more-materials'));
 function controls(){for(const c of host.querySelectorAll('button,input,select'))c.disabled=busy;host.querySelector('[data-source-action="more"]').hidden=!next;if(!recordsOnly)host.querySelector('[data-source-action="more-materials"]').hidden=!materialNext;}
 async function loadMaterials(more=false){
  if(recordsOnly)return;if(!more)materials.clear();const target=select.value,page=target?await remote('evidence',{recordId:target,cursor:more?materialNext:null}):{items:[],next:null};if(disposed)return;materialNext=page.next;
  for(const item of page.items)materials.set(item.id,item);const picker=host.querySelector('[data-source-material]'),prior=picker.value;picker.innerHTML='<option value="">'+esc(tr('attemptChooseMaterial'))+'</option>'+[...materials.values()].map(item=>'<option value="'+item.id+'">'+esc(item.title)+' · '+esc(tr('attemptKind_'+item.kind))+'</option>').join('');picker.value=more&&materials.has(prior)?prior:'';
 }
 async function search(more=false){
  const result=await remote('link-targets',{recordId:record.id,query:host.querySelector('[data-source-query]').value,notebookId:null,after:more?next:null});if(disposed)return;
  if(!more){records.clear();if(!recordsOnly)records.set(record.id,record);}for(const item of result.records)records.set(item.id,item);next=result.next;
  const prior=select.value;select.innerHTML='<option value="">'+esc(tr('linkChoose'))+'</option>'+[...records.values()].map(item=>'<option value="'+item.id+'">'+esc(item.title)+'</option>').join('');select.value=records.has(prior)?prior:recordsOnly?'':record.id;await loadMaterials();
 }
 async function run(work){if(busy)return;busy=true;controls();status.textContent='';try{await work();}catch(error){if(!disposed)status.textContent=error.message;}finally{busy=false;if(!disposed)controls();}}
 host.addEventListener('change',e=>{if(e.target===select)void run(()=>loadMaterials());});
 host.addEventListener('click',e=>{const action=e.target.closest('[data-source-action]')?.dataset.sourceAction;if(!action)return;e.preventDefault();e.stopPropagation();void run(async()=>{
  if(action==='cancel'){onCancel();return;}if(action==='search'||action==='more'){await search(action==='more');return;}
  if(action==='more-materials'){await loadMaterials(true);return;}
  const selected=recordsOnly?records.get(select.value):materials.get(host.querySelector('[data-source-material]').value);if(!selected)throw Error(tr(recordsOnly?'linkChoose':'attemptChooseMaterial'));
  const ref={kind:recordsOnly?'record':selected.kind,id:selected.id,revision:selected.revision},result=await remote('attempt-pin',{recordId:record.id,ref});if(!disposed)onChoose(result.reference);
 });});
 void run(()=>search());return {dispose(){disposed=true;}};
}
