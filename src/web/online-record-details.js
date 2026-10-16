import {t} from './i18n/index.js';
import {STATUSES} from './record-types.js';
import {onlineDetailFieldsFor,onlineDetails,sameDetail,templateDetailName} from './online-details-model.js';
import {templateFieldInput,templateFieldLabel,templateInputValue} from './custom-field-input.js';
const tr=(key,values)=>t('online',key,values);
const labels={title:'recordTitle',status:'progress',outcome:'outcome',tags:'tags'};

// A dedicated owner for manually saved record details. Polling updates clean
// fields, preserves local edits and presents same-field conflicts explicitly.
export function onlineRecordDetails({remote,esc,onChange,notify}){
 let form=null,base=null,latest=null,recordId=null,request=null,busy=false,readOnly=false,disposed=false,generation=0,fields=[],custom=new Map();
 const conflicts=new Map();
 const button=(key,action,field='')=>'<button type="button" class="button" data-detail-action="'+action+'" data-detail-field="'+esc(field)+'">'+esc(tr(key))+'</button>';
 const display=(name,value)=>name==='tags'?(value??[]).join(', '):name==='status'?tr('status_'+value):custom.get(name)?.type==='boolean'&&value!==null?tr(value?'creationYes':'creationNo'):value??'';
 const label=name=>custom.has(name)?templateFieldLabel(custom.get(name)):tr(labels[name]);
 function value(name){const text=form.elements[name].value;if(custom.has(name))return text===''&&base[name]===null?null:templateInputValue(custom.get(name),text);return name==='tags'?text.split(',').map(v=>v.trim()).filter(Boolean):name==='outcome'&&base.outcome===null&&text===''?null:text;}
 function changes(){return fields.filter(name=>!sameDetail(value(name),base[name])).map(name=>({field:name,before:base[name],value:value(name)}));}
 function setValue(name,next){form.elements[name].value=name==='tags'?(next??[]).join(', '):next??'';}
 function controls(){
  if(!form)return;for(const name of fields){const input=form.elements[name];if(input.tagName==='SELECT')input.disabled=busy||!!request||readOnly;else{input.disabled=busy;input.readOnly=!!request||readOnly;}}
  const submit=form.querySelector('[type="submit"]');submit.disabled=busy||readOnly||conflicts.size>0;submit.textContent=tr(request?'retrySend':'saveDetails');
  form.querySelector('[data-detail-action="discard"]').disabled=busy||!!request;
  for(const b of form.querySelectorAll('[data-detail-field]:not([data-detail-field=""])'))b.disabled=busy||!!request||readOnly;
  form.setAttribute('aria-busy',String(busy));
 }
 function drawConflicts(){
  const host=form.querySelector('[data-detail-conflicts]');
  host.innerHTML=conflicts.size?'<p>'+esc(tr('detailsConflict'))+'</p>'+[...conflicts].map(([name,other])=>'<section><h5>'+esc(label(name))+'</h5><dl><dt>'+esc(tr('detailsYours'))+'</dt><dd>'+esc(display(name,value(name))||tr('detailsEmpty'))+'</dd><dt>'+esc(tr('detailsHost'))+'</dt><dd>'+esc(display(name,other)||tr('detailsEmpty'))+'</dd></dl><div class="module-actions">'+button('detailsKeep','keep',name)+button('detailsUseHost','host',name)+'</div></section>').join(''):'';
  controls();
 }
 function update(values,version=generation){
  if(disposed||!form||request||busy||version!==generation)return;
  // Older hosts may omit fields they do not expose. Do not erase a local value
  // or accept unrelated properties while adopting a partial details response.
  latest={...latest,...Object.fromEntries(fields.filter(name=>Object.hasOwn(values,name)).map(name=>[name,structuredClone(values[name])]))};
  for(const name of fields){
   const local=value(name),other=latest[name];
   if(sameDetail(local,base[name])||sameDetail(local,other)){
    if(!sameDetail(local,other))setValue(name,other);base[name]=structuredClone(other);conflicts.delete(name);
   }else if(!sameDetail(base[name],other))conflicts.set(name,structuredClone(other));else conflicts.delete(name);
  }
  onChange(latest);drawConflicts();
 }
 async function save(){
  if(disposed||!form)return;if(busy)throw Error(tr('detailsSaving'));if(readOnly)throw Error(tr('reader'));
  if(!form.reportValidity()||conflicts.size)throw Error(tr(conflicts.size?'detailsConflict':'finishForms'));
  const changed=request?.changes??changes();if(!changed.length)return;
  if(!request&&changed.some(c=>c.field==='tags'&&c.value.some(v=>v.length>40)))throw Error(tr('detailsTagsLimit'));
  request??={recordId,id:crypto.randomUUID(),changes:changed};
  // Store the exact command until acknowledged; unknown transport outcomes
  // must not be turned into a second mutation with a new ID.
  busy=true;generation++;controls();let saved=false;
  try{
   await remote('fields',request);saved=true;
   for(const c of request.changes){base[c.field]=structuredClone(c.value);latest[c.field]=structuredClone(c.value);}
   request=null;onChange(latest);
  }catch(error){
   if(['RECORD_CHANGED','INVALID','COLLABORATION_INVALID','COLLABORATION_DENIED','CONFLICT'].includes(error.code))request=null;
   if(error.code==='RECORD_CHANGED'){
    const response=await remote('details',{recordId});busy=false;update(response.values);throw Error(tr('detailsConflict'));
   }
   throw error;
  }finally{busy=false;generation++;controls();}
  if(saved){form.querySelector('[data-detail-status]').textContent=tr('detailsSaved');}
 }
 function mount(host,record,role){
  recordId=record.id;fields=onlineDetailFieldsFor(record);custom=new Map((record.template?.fields??[]).map(f=>[templateDetailName(f),f]));base=onlineDetails(record);latest=structuredClone(base);readOnly=role!=='editor';request=null;conflicts.clear();
  host.innerHTML='<form data-live-details><h4>'+esc(tr('detailsTitle'))+'</h4><div class="online-details-grid"><label class="field">'+esc(tr('recordTitle'))+'<input name="title" required maxlength="180"></label><label class="field">'+esc(tr('progress'))+'<select name="status" aria-label="'+esc(tr('progress'))+'">'+STATUSES.map(status=>'<option value="'+esc(status)+'">'+esc(tr('status_'+status))+'</option>').join('')+'</select></label><label class="field">'+esc(tr('outcome'))+'<textarea name="outcome" rows="2" maxlength="500"></textarea></label><label class="field">'+esc(tr('tags'))+'<input name="tags" aria-label="'+esc(tr('tags'))+'"><span class="muted">'+esc(tr('detailsTagsHelp'))+'</span></label></div><p class="muted">'+esc(tr(readOnly?'reader':'detailsHelp'))+'</p><div data-detail-conflicts role="status"></div><p data-detail-status role="status"></p><div class="module-actions"><button type="submit" class="button">'+esc(tr('saveDetails'))+'</button>'+button('detailsDiscard','discard')+'</div></form>';
  form=host.querySelector('form');
  if(custom.size){const section=document.createElement('section');section.innerHTML='<h4>'+esc(record.template.label)+'</h4>'+(record.template.description?'<p>'+esc(record.template.description)+'</p>':'')+'<div class="online-details-grid">'+[...custom].map(([name,f])=>'<label class="field">'+esc(templateFieldLabel(f))+templateFieldInput(f,base[name],{esc,attrs:'name="'+esc(name)+'"'})+'</label>').join('')+'</div>';form.querySelector('.online-details-grid').after(section);}
  for(const name of fields)setValue(name,base[name]);controls();
  form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();void save().catch(e=>notify(e.message,true));});
  form.addEventListener('input',()=>{form.querySelector('[data-detail-status]').textContent='';if(conflicts.size)drawConflicts();});
  form.addEventListener('click',event=>{
   const button=event.target.closest('[data-detail-action]');if(!button||busy||request)return;const action=button.dataset.detailAction,name=button.dataset.detailField;
   if(action==='discard'){for(const key of fields){base[key]=structuredClone(latest[key]);setValue(key,latest[key]);}conflicts.clear();}
   else if(!readOnly&&conflicts.has(name)){const other=conflicts.get(name);base[name]=structuredClone(other);if(action==='host')setValue(name,other);conflicts.delete(name);}
   drawConflicts();
  });
 }
 return {mount,update,revision:()=>generation,save,isDirty:()=>!!form&&(busy||!!request||changes().length>0),setReadOnly(){readOnly=true;controls();},dispose(){disposed=true;generation++;form=null;},isBusy:()=>busy};
}
