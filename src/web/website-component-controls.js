const slotKey='data-website-slot';
const textTargets='h1,h2,h3,h4,h5,h6,p,span,figcaption,caption,dt,dd,li,strong,em,small';
function field(host,title,tag='input'){
 const label=document.createElement('label'),caption=document.createElement('span'),control=document.createElement(tag);
 caption.textContent=title;label.append(caption,control);host.append(label);return control;
}
function button(host,title,act){
 const el=document.createElement('button');el.type='button';el.className='button';el.textContent=title;el.onclick=act;host.append(el);return el;
}
const option=(name,value)=>new Option(name,value);
function group(host,caption){
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=caption;details.append(summary);host.append(details);return details;
}

// The parent owns the revision and abort signal. The chooser retains one
// page of matching site resources even for large libraries.
export function componentChoices(host,type,{request,pin,t,signal,selected}){
 const search=field(host,t('componentFindResource')),list=field(host,t('componentMatches'),'select'),nav=document.createElement('div');
 search.type='search';search.maxLength=100;nav.className='inline-actions';host.append(nav);
 let cursor=0,term='',last=null,sequence=0;
 const load=async(offset=0)=>{
  const epoch=++sequence;list.disabled=true;prev.disabled=more.disabled=true;
  try{
   const result=await request('components/choices',{...pin,type,component:selected,query:search.value,offset},{signal});
   if(signal.aborted||epoch!==sequence)return;
   cursor=offset;term=search.value;last=result.next;
   list.replaceChildren(...result.items.map(item=>option(item.name,item.id)));list.disabled=!list.length;prev.disabled=!offset;more.disabled=last===null;
   list.dispatchEvent(new Event('change'));
  }catch(e){if(signal.aborted||epoch!==sequence)return;list.replaceChildren(option(e.message,''));list.disabled=true;}
 };
 button(nav,t('pickerFind'),()=>load());const prev=button(nav,t('pickerPrevious'),()=>load(Math.max(0,cursor-24))),more=button(nav,t('pickerNext'),()=>load(last));
 prev.disabled=more.disabled=true;search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load();}};
 search.oninput=()=>{if(search.value!==term){sequence++;prev.disabled=more.disabled=list.disabled=true;}};
 host.addEventListener('toggle',()=>{if(host.open&&!list.length&&!search.value)load();},{signal});
 return {list,load};
}

export function componentMainControls({host,doc,main,t,request,pin,signal,changed}){
 const slots=structuredClone(main.slots??[]),variants=structuredClone(main.variants??[]);
 const local=document.createElement('section');local.className='component-design-fields';host.append(local);
 const author=group(local,t('componentSlots')),slotList=field(author,t('componentExistingSlot'),'select');
 const target=field(author,t('componentSlotTarget'),'select'),name=field(author,t('componentSlotName'));name.maxLength=100;
 const targets=new Map();const active=()=>slotList.value?slots.find(s=>s.id===slotList.value):null;
 const items=()=>[...doc.body.querySelectorAll(textTargets+',img')].filter(n=>!n.closest('[data-observanda-editor]')&&(n.localName==='img'||!n.children.length));
 const chooseTarget=()=>{
  const slot=active();name.value=slot?.name??'';remove.disabled=!slot;target.disabled=['component','entry'].includes(slot?.type);
  targets.clear();target.replaceChildren();
  for(const n of items()){
   const id=n.getAttribute(slotKey);if(id&&id!==slot?.id)continue;
   const key=String(targets.size);targets.set(key,n);const title=n.getAttribute('alt')||n.textContent;
   target.add(option(n.localName+' · '+(title?.trim()||t('componentEmptyField')).slice(0,90),key));if(id&&id===slot?.id)target.value=key;
  }
 };
 const repaint=selected=>{
  slotList.replaceChildren(option(t('componentNewSlot'),''),...slots.map(s=>option(s.name,s.id)));
  slotList.value=selected??'';chooseTarget();changed();
 };
 const keep=button(author,t('componentKeepSlot'),()=>{
  const node=targets.get(target.value),title=name.value.trim();if(!title)return;
  const old=active(),id=old?.id??crypto.randomUUID();
  if(slots.some(s=>s.id!==id&&s.name.toLowerCase()===title.toLowerCase())){name.setCustomValidity(t('componentDuplicateField'));name.reportValidity();return;}
  if(old&&['component','entry'].includes(old.type)){old.name=title;repaint(id);return;}
  if(!node?.isConnected)return;
  const prior=doc.body.querySelector('['+slotKey+'="'+id+'"]');prior?.removeAttribute(slotKey);node.setAttribute(slotKey,id);
  const next={id,name:title,type:node.localName==='img'?'image':'text'};if(old)slots.splice(slots.indexOf(old),1,next);else slots.push(next);repaint(id);
 }),remove=button(author,t('remove'),()=>{
  const old=active();if(!old)return;const node=doc.body.querySelector('['+slotKey+'="'+old.id+'"]');
  if(['component','entry'].includes(old.type))node?.remove();else node?.removeAttribute(slotKey);
  slots.splice(slots.indexOf(old),1);repaint();
 });
 slotList.onchange=chooseTarget;name.oninput=()=>name.setCustomValidity('');
 author.addEventListener('toggle',()=>{if(author.open)chooseTarget();},{signal});
 button(author,t('componentAddEntryField'),()=>{
  const root=doc.body.firstElementChild;if(!root?.matches('article,section,aside,div,figure'))return;
  const id=crypto.randomUUID(),node=doc.createElement('div'),base=t('componentEntryField');let label=base;
  for(let i=2;slots.some(s=>s.name===label);i++)label=base+' '+i;
  node.setAttribute(slotKey,id);root.append(node);slots.push({id,name:label,type:'entry'});repaint(id);
 });
 const nested=group(local,t('componentNest')),child=componentChoices(nested,'component',{request,pin,t,signal,selected:main.id});
 button(nested,t('componentInsertNested'),()=>{
  const root=doc.body.firstElementChild,item=child.list.selectedOptions[0];
  if(child.list.disabled||!item||!root?.matches('article,section,aside,div,figure'))return;
  const id=crypto.randomUUID(),node=doc.createElement('div');node.setAttribute(slotKey,id);root.append(node);
  let label=item.label;for(let i=2;slots.some(s=>s.name===label);i++)label=item.label+' '+i;
  slots.push({id,name:label,type:'component',component:item.value});repaint(id);
 });
 const styles=group(local,t('componentVariants')),variant=field(styles,t('componentVariant'),'select'),label=field(styles,t('componentVariantName'));label.maxLength=100;
 const tokens=componentChoices(styles,'style',{request,pin,t,signal});
 const paintVariants=selected=>{variant.replaceChildren(option(t('componentNewVariant'),''),...variants.map(v=>option(v.name,v.id)));variant.value=selected??'';label.value=variants.find(v=>v.id===variant.value)?.name??'';};
 variant.onchange=()=>{const v=variants.find(v=>v.id===variant.value);label.value=v?.name??'';if(v&&[...tokens.list.options].some(o=>o.value===v.style))tokens.list.value=v.style;};
 button(styles,t('componentKeepVariant'),()=>{
  if(!label.value.trim()||!tokens.list.value||tokens.list.disabled)return;
  const v=variants.find(v=>v.id===variant.value),id=v?.id??crypto.randomUUID();
  const next={id,name:label.value.trim(),style:tokens.list.value};if(v)variants.splice(variants.indexOf(v),1,next);else variants.push(next);paintVariants(id);changed();
 });
 button(styles,t('remove'),()=>{const at=variants.findIndex(v=>v.id===variant.value);if(at>=0){variants.splice(at,1);paintVariants();changed();}});
 slotList.replaceChildren(option(t('componentNewSlot'),''),...slots.map(s=>option(s.name,s.id)));chooseTarget();paintVariants();
 return {slots,variants};
}
