import {t} from './i18n/index.js';
import './i18n/catalogues/datasetTable.js';
export const columnPickerText=(key,args)=>t('datasetCalculations',key,args);
export async function loadDatasetColumnWindow(call,ref,{view,offset=0,selected=[]}={}){
 const page=await call('calculation-schema',{ref,view,offset,limit:16});
 const items=page.columns.map((column,i)=>({index:page.offset+i,column})),missing=[...new Set(selected)].filter(index=>!items.some(item=>item.index===index));
 if(missing.length){const extra=await call('calculation-schema',{ref,view,columns:missing});items.push(...extra.columns.map((column,i)=>({index:missing[i],column})));}
 return {...page,items,searchRef:ref.kind==='dataset'?ref:null};
}
export function datasetColumnPager(page,{esc,scope=''}){
 if(!page||!Array.isArray(page.columns))return '';
 const button=(offset,key)=>`<button type="button" class="button" data-column-window="${esc(scope)}" data-offset="${offset}">${esc(columnPickerText(key))}</button>`;
 const search=page.total>16&&page.searchRef?`<div data-schema-find="${esc(JSON.stringify(page.searchRef))}"><label>${esc(t('datasetTable','find'))}<input type="search" maxlength="300"></label> <button type="button" data-find-columns>${esc(t('datasetTable','search'))}</button><div data-schema-matches aria-live="polite"></div></div>`:'';
 return `<div class="inline-actions" data-column-pager><p role="status">${esc(columnPickerText('columnWindow',{first:page.total?page.offset+1:0,last:Math.min(page.total,page.offset+page.columns.length),total:page.total}))}</p>${page.offset?button(Math.max(0,page.offset-16),'previousColumns'):''}${page.next!==null?button(page.next,'nextColumns'):''}${page.total>16?`<label>${esc(columnPickerText('firstColumn'))}<input type="number" min="1" max="${page.total}" value="${page.offset+1}" data-column-window-offset></label>${button('input','goToColumns')}`:''}${search}</div>`;
}

export function bindDatasetColumnSearch(form,{call,guard,notify}){
 const panels=[...form.querySelectorAll('[data-schema-find]')];
 if(!panels.length)return;
 const active=new Map();
 for(const panel of panels){
  const field=panel.querySelector('input'),result=panel.querySelector('[data-schema-matches]'),ref=JSON.parse(panel.dataset.schemaFind);
  let next=null,query='';
  async function search(more){
   active.get(panel)?.abort();const controller=new AbortController();active.set(panel,controller);
   const text=field.value,offset=more&&text===query?next??0:0;
   try{
    const found=await call('table-schema-search',{ref,text,offset,limit:8},{signal:controller.signal,adoptOwner:false});
    if(controller.signal.aborted||!panel.isConnected)return;
    guard();query=text;next=found.next;result.replaceChildren();
    if(!found.items.length)result.textContent=t('datasetTable','none');
    for(const {position,name,unit} of found.items){
     const button=document.createElement('button');button.type='button';button.textContent=(position+1)+'. '+name+(unit?' · '+unit:'');
     button.onclick=()=>{
      const pager=panel.closest('[data-column-pager]');
      pager.querySelector('[data-column-window-offset]').value=String(position+1);
      pager.querySelector('[data-column-window][data-offset="input"]').click();
     };
     result.append(button);
    }
    if(next!==null){const more=document.createElement('button');more.type='button';more.textContent=t('datasetTable','more');more.onclick=()=>search(true);result.append(more);}
    if(offset)result.querySelector('button')?.focus();
   }catch(error){if(!controller.signal.aborted&&panel.isConnected)notify(error.message,true);}
   finally{if(active.get(panel)===controller)active.delete(panel);}
  }
  panel.querySelector('[data-find-columns]').onclick=()=>search(false);
  field.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void search(false);}};
 }
 return ()=>{for(const controller of active.values())controller.abort();active.clear();};
}
export function datasetProjectionFields(page,selected,{esc,scope=''}){
 if(!page||!Array.isArray(page.columns))return '';
 return `<fieldset data-column-projection="${esc(scope)}"><legend>${esc(columnPickerText('retainedColumns'))}</legend><p>${esc(columnPickerText('projectionHelp'))}</p>${datasetColumnPager(page,{esc,scope})}${page.items.map(({index,column})=>`<label class="checkbox"><input type="checkbox" data-projection-column="${index}"${selected.includes(index)?' checked':''}>${index+1}. ${esc(column.name)}</label>`).join('')}<p>${esc(columnPickerText('projectionOrder',{columns:selected.map(i=>String(i+1)).join(', ')}))}</p></fieldset>`;
}

export function datasetColumnPageOffset(control){
 if(control.dataset.offset!=='input')return Number(control.dataset.offset);
 const input=control.closest('[data-column-pager]').querySelector('[data-column-window-offset]'),value=Number(input.value);
 if(!Number.isSafeInteger(value)||value<1||value>Number(input.max))throw Error(columnPickerText('invalidColumn'));
 return value-1;
}
