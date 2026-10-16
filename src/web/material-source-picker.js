import {materialReference,materialReferenceKey} from './material-reference.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('materialSources',key,args);
const reference=materialReference;
const key=materialReferenceKey;
// Current source/selection pages stay in memory; exact multi-selection membership
// lives in the workspace's encrypted immutable index.
export function materialSourcePicker({root,call,esc,field,label,id,recordId,kind=null,multiple=false,optional=false,scope='record',guard,onBusy=()=>{},onInspect=null}){
 let selected=new Map(),selection=null,count=0,selectionOffset=0,cursor=null,next=null,pages=[],items=[],request=null,generation=0,disposed=false,busy=false;
 const draft=root.querySelector('[data-value]');let baseline='[]';
 root.innerHTML='<fieldset><legend>'+esc(label)+'</legend>'+
  '<div class="material-fields">'+field(esc(text('scope',{label})),'<select data-scope><option value="record">'+esc(text('thisRecord'))+'</option><option value="all">'+esc(text('allRecords'))+'</option></select>')+
  field(esc(text('search',{label:label.toLowerCase()})),'<input data-search type="search" maxlength="200">')+'</div>'+
  '<button type="button" data-search-button class="button">'+esc(text('searchButton'))+'</button>'+
  '<p data-status role="status"></p><div data-selection></div>'+(multiple?'<div class="inline-actions"><button type="button" class="button" data-select-page>'+esc(text('selectPage'))+'</button><button type="button" class="button" data-clear-page>'+esc(text('clearPage'))+'</button></div>':'')+'<div data-choices></div>'+
  '<div class="inline-actions"><button type="button" data-first class="button">'+esc(text('first'))+'</button><button type="button" data-prev class="button">'+esc(text('previous'))+'</button><button type="button" data-next class="button">'+esc(text('more'))+'</button><button type="button" data-refresh class="button">'+esc(text('refresh'))+'</button></div></fieldset>';
 root.append(draft);
 root.querySelector('[data-scope]').value=scope==='all'?'all':'record';
 const choices=root.querySelector('[data-choices]'),status=root.querySelector('[data-status]'),summary=root.querySelector('[data-selection]');
 const alive=()=>!disposed&&root.isConnected;
 const signalChange=()=>{
  const value=multiple?(count?JSON.stringify({selection,count}):''):JSON.stringify([...selected.values()].map(reference));
  const updated=multiple?value:value===baseline?'':value;
  if(draft.value!==updated){draft.value=updated;draft.dispatchEvent(new Event('input',{bubbles:true}));}
 };
 function setBusy(value){
  busy=value;onBusy(value);root.toggleAttribute('aria-busy',value);if(value)root.setAttribute('aria-busy','true');
  root.querySelectorAll('button,select,input').forEach(el=>el.disabled=value);
  if(!value){
   root.querySelector('[data-first]').disabled=cursor===null;root.querySelector('[data-prev]').disabled=!pages.length;root.querySelector('[data-next]').disabled=!next;
   const previous=summary.querySelector('[data-selected-prev]'),more=summary.querySelector('[data-selected-next]');
   if(previous)previous.disabled=selectionOffset===0;if(more)more.disabled=selectionOffset+10>=count;
   if(multiple){root.querySelector('[data-select-page]').disabled=!items.some(item=>!selected.has(key(item)));root.querySelector('[data-clear-page]').disabled=!items.some(item=>selected.has(key(item)));}
  }
 }
 async function summaryPage(){
  if(!multiple)return;
  selectionOffset=Math.min(selectionOffset,Math.max(0,Math.floor((count-1)/10)*10));
  const page=selection?await call('selection-page',{recordId,kind,selection,offset:selectionOffset,members:items.map(reference)},{adopt:false,signal:request.signal}):{items:[],selected:[]};
  if(!alive())return;guard();
  selected=new Map(page.selected.map(item=>[key(item),item]));
  const expanded=summary.querySelector('details')?.open??false;
  summary.innerHTML='<details'+(expanded?' open':'')+'><summary>'+esc(text('selected',{count}))+'</summary><ul>'+page.items.map((item,i)=>'<li>'+esc(item.title)+' · '+esc(item.kind)+' · '+item.revision.slice(0,10)+(onInspect?' <button type="button" class="button" data-inspect="'+i+'" aria-label="'+esc(text('inspect',{title:item.title}))+'">'+esc(text('details'))+'</button>':'')+' <button type="button" class="button" data-remove="'+i+'">'+esc(text('remove'))+'</button></li>').join('')+'</ul>'+
   (count>10?'<div class="inline-actions"><button type="button" class="button" data-selected-prev>'+esc(text('previousSelected'))+'</button><button type="button" class="button" data-selected-next>'+esc(text('moreSelected'))+'</button></div>':'')+'</details>';
  summary.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>void change(page.items[Number(button.dataset.remove)],false));
  summary.querySelectorAll('[data-inspect]').forEach(button=>button.onclick=()=>onInspect(reference(page.items[Number(button.dataset.inspect)])));
  const previous=summary.querySelector('[data-selected-prev]'),more=summary.querySelector('[data-selected-next]');
  if(previous){previous.onclick=()=>void moveSelection(-10);more.onclick=()=>void moveSelection(10);}
 }
 function display(){
  if(multiple){
   choices.innerHTML=items.map((item,i)=>'<div><label class="material-choice"><input type="checkbox" value="'+esc(key(item))+'"'+(selected.has(key(item))?' checked':'')+'>'+esc(item.title)+' · '+esc(item.kind)+' · '+item.revision.slice(0,10)+'</label>'+(onInspect?'<button type="button" class="button" data-inspect="'+i+'" aria-label="'+esc(text('inspect',{title:item.title}))+'">'+esc(text('details'))+'</button>':'')+'</div>').join('');
   choices.querySelectorAll('input').forEach((el,i)=>el.addEventListener('change',()=>void change(items[i],el.checked)));
   choices.querySelectorAll('[data-inspect]').forEach(button=>button.onclick=()=>onInspect(reference(items[Number(button.dataset.inspect)])));
  }else{
   const options=new Map([...selected,...items.map(item=>[key(item),item])]),value=selected.keys().next().value??'';
   choices.innerHTML=field(esc(label),'<select id="'+esc(id)+'">'+(optional?'<option value="">'+esc(text('none'))+'</option>':'<option value="" disabled>'+esc(text('select'))+'</option>')+[...options].map(([k,item])=>'<option value="'+esc(k)+'">'+esc(item.title)+' · '+item.revision.slice(0,10)+'</option>').join('')+'</select>');
   const select=choices.querySelector('select');select.value=value;
   select.addEventListener('change',()=>{selected.clear();if(select.value)selected.set(select.value,options.get(select.value));signalChange();});
  }
 }
 async function change(item,checked){
  if(busy||disposed)return;setBusy(true);request=new AbortController();
  try{
   const result=await call('selection-change',{recordId,kind,selection,...(Array.isArray(item)?{refs:item.map(reference)}:{ref:reference(item)}),checked},{adopt:false,signal:request.signal});
   if(!alive())return;guard();selection=result.selection;count=result.count;signalChange();
   await summaryPage();if(alive()){display();status.textContent=text('selected',{count});}
  }catch(error){if(alive()&&error.name!=='AbortError'){display();status.textContent=error.message??text('changeFailed');}}
  finally{if(alive())setBusy(false);}
 }
 async function moveSelection(by){
  if(busy)return;setBusy(true);request=new AbortController();const prior=selectionOffset;selectionOffset+=by;
  try{await summaryPage();}catch(error){selectionOffset=prior;if(alive()&&error.name!=='AbortError')status.textContent=error.message??text('loadFailed');}
  finally{if(alive())setBusy(false);}
 }
 async function load({reset=false,initial=false}={}){
  if(reset){cursor=null;pages=[];}request?.abort();request=new AbortController();const current=++generation;
  status.textContent=text('loading');setBusy(true);
  try{
   const page=await call('list',{recordId:root.querySelector('[data-scope]').value==='record'?recordId:null,kind,query:root.querySelector('[data-search]').value,cursor},{signal:request.signal,adopt:false});
   if(!alive()||current!==generation)return;guard();next=page.next;items=page.items;
   if(initial&&!multiple&&!optional&&items.length)selected.set(key(items[0]),items[0]);
   if(initial)baseline=JSON.stringify([...selected.values()].map(reference));
   await summaryPage();if(!alive()||current!==generation)return;display();signalChange();
   status.textContent=(items.length?text('shown',{count:items.length}):text('empty'))+(next?' '+text('available'):'')+(page.changed?' '+text('changed'):'');
  }catch(error){if(alive()&&current===generation&&error.name!=='AbortError')status.textContent=error.message??text('loadFailed');}
  finally{if(alive()&&current===generation)setBusy(false);}
 }
 root.querySelector('[data-next]').onclick=()=>{if(!busy&&next){pages.push(cursor);if(pages.length>32)pages.shift();cursor=next;void load();}};
 root.querySelector('[data-prev]').onclick=()=>{if(!busy&&pages.length){cursor=pages.pop();void load();}};
 root.querySelector('[data-first]').onclick=()=>void load({reset:true});
 root.querySelector('[data-search-button]').onclick=()=>void load({reset:true});
 root.querySelector('[data-refresh]').onclick=()=>void load({reset:true});
 root.querySelector('[data-scope]').onchange=()=>void load({reset:true});
 if(multiple){root.querySelector('[data-select-page]').onclick=()=>void change(items,true);root.querySelector('[data-clear-page]').onclick=()=>void change(items,false);}
 root.querySelector('[data-search]').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();if(!busy)void load({reset:true});}};
 function readySelection(){guard();if(busy)throw Error(text('wait'));if(disposed)throw Error(text('closed'));}
 return {ready:load({initial:true}),
  snapshot(){readySelection();if(!multiple)throw Error(text('invalid'));return {recordId,kind,selection,count};},
  values(){readySelection();if(multiple)throw Error(text('invalid'));if(!optional&&!selected.size)throw Error(text('required',{label:label.toLowerCase()}));return [...selected.values()].map(reference);},
  dispose(){disposed=true;request?.abort();selected.clear();items=[];pages=[];}
 };
}
