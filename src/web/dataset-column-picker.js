import {t} from './i18n/index.js';
export const columnPickerText=(key,args)=>t('datasetCalculations',key,args);
export async function loadDatasetColumnWindow(call,ref,{view,offset=0,selected=[]}={}){
 const page=await call('calculation-schema',{ref,view,offset,limit:16});
 const items=page.columns.map((column,i)=>({index:page.offset+i,column})),missing=[...new Set(selected)].filter(index=>!items.some(item=>item.index===index));
 if(missing.length){const extra=await call('calculation-schema',{ref,view,columns:missing});items.push(...extra.columns.map((column,i)=>({index:missing[i],column})));}
 return {...page,items};
}
export function datasetColumnPager(page,{esc,scope=''}){
 if(!page||!Array.isArray(page.columns))return '';
 const button=(offset,key)=>`<button type="button" class="button" data-column-window="${esc(scope)}" data-offset="${offset}">${esc(columnPickerText(key))}</button>`;
 return `<div class="inline-actions" data-column-pager><p role="status">${esc(columnPickerText('columnWindow',{first:page.total?page.offset+1:0,last:Math.min(page.total,page.offset+page.columns.length),total:page.total}))}</p>${page.offset?button(Math.max(0,page.offset-16),'previousColumns'):''}${page.next!==null?button(page.next,'nextColumns'):''}${page.total>16?`<label>${esc(columnPickerText('firstColumn'))}<input type="number" min="1" max="${page.total}" value="${page.offset+1}" data-column-window-offset></label>${button('input','goToColumns')}`:''}</div>`;
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
