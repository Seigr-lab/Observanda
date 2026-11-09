import {breakpointLabel,breakpointCondition,defaultBreakpoints,validBreakpoints} from './website-breakpoint-model.js';

export function editWebsiteBreakpoints({site,t,review,apply,current,signal,trigger}){
 let ranges=structuredClone(site.breakpoints??defaultBreakpoints()),selected=null,plan=null,busy=false,changed=false,rowDirty=false;
 const dialog=document.createElement('dialog');dialog.className='website-author-dialog website-range-dialog';dialog.dataset.websiteRanges='';
 const add=(parent,tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;parent.append(el);return el;};
 const label=(parent,key,type)=>{const wrap=add(parent,'label');add(wrap,'span',t(key));const el=add(wrap,'input');el.type=type;if(type==='number'){el.min=1;el.max=16384;el.step=1;}return el;};
 const button=(owner,key,act)=>{const b=add(owner,'button',t(key));b.type='button';b.className='button';b.onclick=async()=>{if(!current()||busy)return;try{await act();}catch(e){if(dialog.open)status.textContent=e.message||t('failed');}};return b;};
 const header=add(dialog,'header'),heading=add(header,'h2',t('breakpointManage'));heading.id='website-range-title';dialog.setAttribute('aria-labelledby',heading.id);
 const close=button(header,'finderClose',dismiss);
 const content=add(dialog,'div');content.className='website-range-columns';
 const nav=add(content,'section'),list=add(nav,'div');list.className='website-range-list';
 const fresh=button(nav,'breakpointNew',()=>choose(null));
 const form=add(content,'form');form.onsubmit=e=>{e.preventDefault();storeRow();};
 const name=label(form,'breakpointName','text'),min=label(form,'breakpointMin','number'),max=label(form,'breakpointMax','number');
 name.maxLength=160;add(form,'p',t('breakpointLimitsHint')).className='muted';
 const rowButtons=add(form,'div');rowButtons.className='inline-actions';
 const store=button(rowButtons,'breakpointKeep',storeRow),remove=button(rowButtons,'remove',()=>{
  update(ranges.filter(r=>r.id!==selected.id));select(null);
 });
 const order=add(form,'div');order.className='inline-actions';
 const up=button(order,'up',()=>move(-1)),down=button(order,'down',()=>move(1));
 const result=add(dialog,'section');result.setAttribute('aria-live','polite');
 const status=add(dialog,'p');status.setAttribute('role','status');
 const footer=add(dialog,'footer'),inspect=button(footer,'breakpointReview',async()=>{
  await task(async()=>{plan=await review(ranges);if(!current())return;
   result.replaceChildren();add(result,'p',t('breakpointImpact',{count:plan.changed,manual:plan.manual}));
   if(plan.files.length){const ul=add(result,'ul');for(const file of plan.files)add(ul,'li',file);}
   commit.hidden=false;commit.focus();
  });
 }),commit=button(footer,'breakpointSave',async()=>{
  if(!plan)return;
  await task(async()=>{await apply(ranges,plan.reviewId);changed=false;dialog.close();});
 });commit.classList.add('button-primary');commit.hidden=true;
 function dismiss(){if(!busy&&(!(changed||rowDirty)||confirm(t('discardConfirm'))))dialog.close();}
 function choose(row){if(!rowDirty||confirm(t('discardConfirm')))select(row);}
 function update(value){ranges=value;changed=true;plan=null;commit.hidden=true;result.replaceChildren();paint();}
 function select(row){
  rowDirty=false;selected=row;name.value=row?breakpointLabel(row,t):'';min.value=row?.min??'';max.value=row?.max??'';
  const fixed=row&&['tablet','phone'].includes(row.id);name.disabled=min.disabled=max.disabled=Boolean(fixed);
  store.disabled=Boolean(fixed);remove.disabled=!row||Boolean(fixed);
  const pos=ranges.indexOf(row);up.disabled=pos<=0;down.disabled=pos<0||pos>=ranges.length-1;
  paint();if(!row)name.focus();
 }
 function paint(){
  list.replaceChildren(...ranges.map(r=>{const b=document.createElement('button');b.type='button';b.className='button';b.setAttribute('aria-pressed',String(r===selected));
   b.textContent=breakpointLabel(r,t)+' · '+breakpointCondition(r);b.onclick=()=>choose(r);return b;}));
  inspect.disabled=!changed||rowDirty;
 }
 function move(direction){
  const old=ranges.indexOf(selected),at=old+direction;if(old<0||at<0||at>=ranges.length)return;
  const next=ranges.slice();next.splice(old,1);next.splice(at,0,selected);update(next);select(selected);
 }
 function storeRow(){
  if(!name.value.trim()){name.setCustomValidity(t('breakpointInvalid'));name.reportValidity();return;}
  if(!form.reportValidity())return;
  const row={id:selected?.id??crypto.randomUUID(),name:name.value.trim(),min:min.value===''?null:min.valueAsNumber,max:max.value===''?null:max.valueAsNumber};
  const next=ranges.slice(),at=selected?next.indexOf(selected):next.findIndex(r=>r.max!==null&&row.max!==null&&r.max<row.max&&(row.min??1)<=(r.min??1));
  if(selected)next.splice(at,1,row);else next.splice(at<0?next.length:at,0,row);
  if(!validBreakpoints(next)){status.textContent=t('breakpointInvalid');return;}
  status.textContent='';update(next);select(row);
 }
 async function task(action){
  busy=true;close.disabled=true;content.inert=footer.inert=true;dialog.setAttribute('aria-busy','true');
  try{await action();}finally{busy=false;close.disabled=false;content.inert=footer.inert=false;dialog.removeAttribute('aria-busy');}
 }
 form.oninput=()=>{name.setCustomValidity('');rowDirty=true;inspect.disabled=up.disabled=down.disabled=true;plan=null;commit.hidden=true;result.replaceChildren();};
 const abort=()=>dialog.close();signal.addEventListener('abort',abort,{once:true});
 dialog.addEventListener('close',()=>{signal.removeEventListener('abort',abort);dialog.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
 dialog.oncancel=e=>{e.preventDefault();dismiss();};
 document.body.append(dialog);dialog.showModal();select(ranges[0]);fresh.focus();
}
