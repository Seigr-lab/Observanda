import {t} from './i18n/index.js';
import {retainedTableView} from './retained-table-model.js';
export const tableText=(k,args)=>t('retainedTables',k,args);
export function retainedTableUI({root,call,esc,field,guard,notify,onTable=()=>{}}){
 let selection=null,source=null,columns=[],generation=0;
 async function load(ref,table,draftSelection){
  const request=++generation;source=ref;root.replaceChildren();if(!ref||ref.kind!=='dataset')return;
  const data=await call('schema',{ref,offset:0,limit:256});guard();if(!root.isConnected||request!==generation)return;columns=data.items;
  selection=draftSelection??table?.selection??{columns:columns.slice(0,8).map((_,i)=>i),offset:0,count:20,includeExcluded:false};
  root.innerHTML='<p>'+esc(tableText('help'))+'</p><fieldset><legend>'+esc(tableText('columns'))+'</legend>'+columns.map((c,i)=>'<label class="material-choice"><input type="checkbox" data-table-column="'+i+'"'+(selection.columns.includes(i)?' checked':'')+'>'+esc(c.name+(c.unit?' ['+c.unit+']':''))+'</label>').join('')+'</fieldset>'+field(esc(tableText('offset')),'<input data-table-offset type="number" min="0" value="'+selection.offset+'">')+field(esc(tableText('count')),'<input data-table-count type="number" min="1" max="1000" value="'+selection.count+'">')+'<label><input data-table-excluded type="checkbox"'+(selection.includeExcluded?' checked':'')+'>'+esc(tableText('includeExcluded'))+'</label><button type="button" class="button" data-table-load>'+esc(tableText('load'))+'</button><div data-table-preview>'+(table?retainedTableView(table,esc,{message:tableText}):'')+'</div>';
  root.querySelector('[data-table-load]').onclick=()=>{void read().then(table=>{if(root.isConnected){root.querySelector('[data-table-preview]').innerHTML=retainedTableView(table,esc,{message:tableText});onTable(table);}}).catch(e=>notify(e.message,true));};
 }
 function selected(){return {columns:[...root.querySelectorAll('[data-table-column]:checked')].map(el=>Number(el.dataset.tableColumn)),offset:Number(root.querySelector('[data-table-offset]').value),count:Number(root.querySelector('[data-table-count]').value),includeExcluded:root.querySelector('[data-table-excluded]').checked};}
 async function read(){
  if(!source||!root.querySelector('[data-table-offset]'))throw Error(tableText('invalid'));
  selection=selected();const request=generation,requested=JSON.stringify(selection);
  const table=await call('retained-table',{ref:source,selection});guard();if(request!==generation||requested!==JSON.stringify(selected()))throw Error(tableText('invalid'));return table;
 }
 return {load,read,selected,stop(){generation++;}};
}
