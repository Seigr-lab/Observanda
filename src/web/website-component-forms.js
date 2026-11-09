import {componentChoices} from './website-component-controls.js';

function append(node,tag,text){
 const e=node.ownerDocument.createElement(tag);if(text!==undefined)e.textContent=text;node.append(e);return e;
}
export function componentFragment(doc){
 const clone=doc.body.cloneNode(true);
 for(const n of clone.querySelectorAll('[data-observanda-editor]'))n.remove();
 for(const img of clone.querySelectorAll('img[data-observanda-editor-image]')){img.setAttribute('src',img.dataset.observandaEditorImage);delete img.dataset.observandaEditorImage;}
 for(const n of clone.querySelectorAll('[data-observanda-editor-editable]')){
  const was=n.dataset.observandaEditorEditable;if(was==='absent')n.removeAttribute('contenteditable');else n.setAttribute('contenteditable',was);delete n.dataset.observandaEditorEditable;
 }
 return clone.innerHTML;
}
export function componentReviewView(panel,impact,t){
 panel.replaceChildren();append(panel,'h3',t('componentReviewTitle'));
 append(panel,'p',t('componentImpactCounts',{instances:impact.instances,pages:impact.pages,overrides:impact.removedOverrides}));
 if(impact.slots.length){
  const list=append(panel,'ul');for(const change of impact.slots)append(list,'li',(change.before||'—')+' → '+(change.after||'—'));
 }
 if(impact.rows.length){
  const places=append(panel,'details');append(places,'summary',t('componentUses'));
  const list=append(places,'ul');for(const r of impact.rows)append(list,'li',r.path+' · '+r.count);
 }
}

export function instanceForm({host,value,request,pin,t,apply,close}){
 const control=new AbortController(),signal=control.signal;host.addEventListener('close',()=>control.abort(),{once:true});
 append(host,'h2',value.name);const form=append(host,'form'),values=structuredClone(value.values),css=[...value.variants];
 const input=(owner,label,tag)=>{const wrap=append(owner,'label');append(wrap,'span',label);return append(wrap,tag);};
 const toggle=(parent,label)=>{const wrap=append(parent,'label'),c=append(wrap,'input');c.type='checkbox';wrap.append(' '+label);return c;};
 const variant=input(form,t('componentVariant'),'select');variant.add(new Option(t('sectionInherit'),''));
 for(const v of css)variant.add(new Option(v.name,v.id));variant.value=value.variant??'';variant.parentElement.hidden=!css.length;
 for(const slot of value.slots){
  if(slot.type==='component'||slot.type==='entry')continue;
  const box=append(form,'fieldset');append(box,'legend',slot.name);
  const own=toggle(box,t('componentOverride')),fields=append(box,'div');
  own.checked=Object.hasOwn(values,slot.id);fields.hidden=!own.checked;
  let capture=()=>{};
  if(slot.type==='text'){
   const text=input(fields,t('componentLocalText'),'textarea');text.value=values[slot.id]??'';text.oninput=()=>{values[slot.id]=text.value;};capture=text.oninput;
  }else{
   const peek=append(fields,'img');peek.className='component-slot-photo';peek.alt='';
   const chooser=append(fields,'details');append(chooser,'summary',t('componentChoosePicture'));
   const pick=componentChoices(chooser,'image',{request,pin,t,signal}),alt=input(fields,t('componentAlternative'),'input');
   const candidate=append(chooser,'img');candidate.className='component-slot-photo';candidate.alt='';candidate.hidden=true;
   const previewURL=name=>'/api/website-files/preview/'+pin.siteId+'/'+pin.expectedRevision+'/'+name+'?canvas=1';
   pick.list.addEventListener('change',()=>{candidate.hidden=!pick.list.value||pick.list.disabled;if(candidate.hidden)candidate.removeAttribute('src');else candidate.src=previewURL(pick.list.value);},{signal});
   alt.value=values[slot.id]?.alt??'';
   let chosen=values[slot.id]?.src??'';
   const refresh=()=>{peek.hidden=!chosen;if(chosen)peek.src=previewURL(chosen);else peek.removeAttribute('src');};
   capture=()=>{if(chosen)values[slot.id]={src:chosen,alt:alt.value};};refresh();alt.oninput=capture;
   const use=append(chooser,'button',t('componentUsePicture'));use.type='button';use.onclick=()=>{if(!pick.list.disabled&&pick.list.value){chosen=pick.list.value;capture();refresh();chooser.open=false;}};
  }
  own.onchange=()=>{fields.hidden=!own.checked;if(own.checked)capture();else delete values[slot.id];};
 }
 const error=append(form,'p');error.setAttribute('role','alert');
 const buttons=append(form,'div');buttons.className='inline-actions';const save=append(buttons,'button',t('componentApplyInstance'));save.type='submit';
 const cancel=append(buttons,'button',t('cancel'));cancel.type='button';cancel.onclick=close;
 form.onsubmit=async e=>{e.preventDefault();if(form.inert)return;
  for(const box of form.querySelectorAll('fieldset'))if(box.querySelector('input[type=checkbox]')?.checked&&box.querySelector('img')&&!box.querySelector('img').getAttribute('src')){error.textContent=t('componentChoosePicture');return;}
  form.inert=true;try{await apply({values,variant:variant.value||null});}catch(e){error.textContent=e.message||t('failed');}finally{form.inert=false;}
 };
 return {dispose:()=>control.abort()};
}
