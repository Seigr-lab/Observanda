import {t} from './i18n/index.js';
import {RECORD_TYPES} from './record-types.js';
import {recordTypeLabel} from './record-type-presentation.js';
import {renderProse} from './prose-model.js';
import {documentEditors} from './document-editor.js';
export function recordStarterPages({request,esc,frame:display,notify,onBack}){
 const msg=(key,args)=>t('recordStarters',key,args),text=(key,args)=>esc(msg(key,args)),root=()=>document.querySelector('#dialog');
 let session=null,serial=0,fieldValue=null,fieldBaseline='',pending=null,busy=false;
 const frame=(title,html)=>{display(title,html);root().querySelector('.record-starters').inert=busy;};
 async function run(operation){if(busy)return true;busy=true;const panel=root().querySelector('.record-starters');if(panel)panel.inert=true;try{return await operation();}finally{busy=false;const current=root().querySelector('.record-starters');if(current)current.inert=false;}}
 const editors=documentEditors({context:()=>serial,destinations:()=>[],figures:()=>[],onError:e=>notify(e,true)});
 const button=(key,action,extra='')=>'<button type="button" class="button" data-action="starter-page-'+action+'" '+extra+'>'+text(key)+'</button>';
 const input=(key,html)=>'<label class="field">'+text(key)+html+'</label>';
 function stop(){serial++;session=null;editors.release();pending=null;}
 async function query(operation,data){const current=session,result=await request(current.target.uploadId?'package'+operation[0].toUpperCase()+operation.slice(1):operation,{...current.target,...data});if(current!==session)throw Error(msg('reopen'));return result;}
 async function overview(offset=0){
  const result=await query('view',{offset});session.view=result;editors.release();const {blueprint:b,sections:p}=result,edit=session.editing;
  frame(b.name,`<p>${text(edit?'pagedEditHelp':'pagedReadHelp')}</p>${edit?`<form id="starter-details-form">${input('name',`<input name="name" required maxlength="120" value="${esc(b.name)}">`)}${input('title',`<input name="title" required maxlength="180" value="${esc(b.title)}">`)}${input('type',`<select name="type">${RECORD_TYPES.map(type=>`<option value="${type.id}" ${b.type===type.id?'selected':''}>${esc(recordTypeLabel(type.id))}</option>`).join('')}</select>`)}<button class="button primary" type="submit">${text('saveDetails')}</button></form>`:`<h3>${esc(b.title)}</h3>`}
   <div class="inline-actions">${button('body','body')}${button('tagList','tags')}</div>
   <p>${text(p.total?'sourceRange':'sourceEmpty',{first:p.offset+1,last:p.offset+p.values.length,total:p.total})}</p><ol start="${p.offset+1}">${p.values.map(s=>`<li><span>${esc(s.title)}</span> ${button(edit?'editSection':'readSection','section',`data-position="${s.position}"`)}</li>`).join('')}</ol>
   <div class="inline-actions">${button('sourcePrevious','previous',p.offset?'':'disabled')}${button('sourceNext','next',p.offset+p.values.length<p.total?'':'disabled')}</div>
   ${p.total?input('sourceGoTo',`<input type="number" data-template-position min="1" max="${p.total}" value="${p.offset+1}">`)+button('sourceGo','go'):''}
   ${edit?button('addSection','add'):''}<div class="dialog-actions">${button('backToTemplate','back')}</div>`);
 }
 async function selected(field,position=0){
  const result=await query('field',{field,position});if(result.header&&result.header.revision!==session.view.header.revision)throw Error(msg('changed'));serial++;editors.release();session.field={field,position,header:result.header};fieldValue=structuredClone(result.value);fieldBaseline=JSON.stringify(fieldValue);pending=null;
  if(field==='tags'){
   frame(msg('tagList'),`<ul>${result.value.map((tag,i)=>`<li>${esc(tag)} ${session.editing?button('removeTag','removeTag',`data-position="${position+i}"`):''}</li>`).join('')}</ul><div class="inline-actions">${button('previousTags','previousTags',position?'':'disabled')}${button('nextTags','nextTags',position+result.value.length<result.total?'':'disabled')}</div>${session.editing?`<form id="starter-tag-form">${input('tag','<input name="tag" maxlength="40" required>')}<button class="button" type="submit">${text('addTag')}</button></form>`:''}${button('backToSections','overview')}`);return;
  }
  const body=field==='body'?fieldValue:fieldValue.body,title=field==='body'?msg('body'):fieldValue.title;
  if(!session.editing){frame(title,`<div class="prose">${renderProse(body)}</div>${button('backToSections','overview')}`);return;}
  const rich=editors.field({key:'starter-selected',label:msg(field==='body'?'body':'sectionBody'),value:body,set:value=>{if(field==='body')fieldValue=value;else fieldValue.body=value;const marker=root().querySelector('[name="instructions"]');if(marker)marker.value=JSON.stringify(fieldValue);}});
  frame(title,`<form id="starter-field-form"><input type="hidden" name="instructions" value="${esc(fieldBaseline)}">${field==='section'?input('section',`<input name="title" required maxlength="160" value="${esc(title)}">`):''}${rich}<div class="dialog-actions"><button class="button primary" type="submit">${text('save')}</button>${button('backToSections','overview')}</div></form>${field==='section'?`<div class="inline-actions">${button('up','up',position?'':'disabled')}${button('down','down',position+1<session.view.sections.total?'':'disabled')}${button('removeSection','remove')}</div>`:''}`);editors.bind(root());
 }
 async function change(operation,position,value,header=session.view.header){
  const payload={id:session.target.id,expectedRevision:header.revision,operation,position,value},marker=JSON.stringify(payload);
  if(pending?.marker!==marker)pending={marker,command:{...payload,commandId:crypto.randomUUID()}};
  const result=await request('change',pending.command);pending=null;session.view.header=result.header;notify(msg('saved'));return result;
 }
 const handlers={stop,async start(target,{editing=false}={}){stop();session={target,editing,view:null,field:null};await overview();},async action(control){
  const name=control.dataset.action;if(!name?.startsWith('starter-page-'))return false;if(!session)return true;const op=name.slice(13),p=session.view.sections,position=session.field?.position??0;
  if(op==='back'){stop();await onBack();}
  if(op==='overview')await overview(p.offset);
  if(op==='previous')await overview(Math.max(0,p.offset-20));if(op==='next')await overview(p.offset+p.values.length);
  if(op==='go'){const el=root().querySelector('[data-template-position]');if(el.reportValidity())await overview(Number(el.value)-1);}
  if(op==='body')await selected('body');if(op==='section')await selected('section',Number(control.dataset.position));
  if(op==='tags')await selected('tags');if(op==='previousTags')await selected('tags',Math.max(0,position-20));if(op==='nextTags')await selected('tags',position+20);
  if(op==='removeTag'){await change('tag-remove',Number(control.dataset.position),null,session.field.header);await selected('tags',Math.max(0,position-(position===session.view.tags-1?20:0)));}
  if(op==='add'){await change('insert',p.total,{title:msg('blankSection'),body:''});await overview(p.total);await selected('section',p.total);}
  if(op==='remove'){await change('remove',position,null,session.field.header);await overview(p.offset);}
  if(['up','down'].includes(op)){const to=position+(op==='up'?-1:1);await change('move',position,to,session.field.header);await overview(p.offset);await selected('section',to);}
  return true;
 },async submit(form){
  if(!['starter-details-form','starter-field-form','starter-tag-form'].includes(form.id))return false;
  const data=new FormData(form),s=session;
  if(form.id==='starter-details-form'){await change('details',0,{name:data.get('name'),title:data.get('title'),type:data.get('type')});await overview(s.view.sections.offset);}
  if(form.id==='starter-field-form'){if(s.field.field==='section')fieldValue.title=data.get('title');await change(s.field.field,s.field.position,fieldValue,s.field.header);await selected(s.field.field,s.field.position);}
  if(form.id==='starter-tag-form'){await change('tag-add',0,data.get('tag'),s.field.header);await selected('tags',s.field.position);}
  return true;
 }};
 return {stop,start:(...args)=>run(()=>handlers.start(...args)),action:control=>control.dataset.action?.startsWith('starter-page-')?run(()=>handlers.action(control)):false,submit:form=>['starter-details-form','starter-field-form','starter-tag-form'].includes(form.id)?run(()=>handlers.submit(form)):false};
}
