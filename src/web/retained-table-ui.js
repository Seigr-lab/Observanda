import {t} from './i18n/index.js';
import {retainedTableView} from './retained-table-model.js';
export const tableText=(k,args)=>t('retainedTables',k,args);
const button=(key,attribute,disabled=false)=>'<button type="button" class="button" '+attribute+(disabled?' disabled':'')+'>'+tableText(key)+'</button>';
export async function paintRetainedTable(root,{call,ref,table,esc,guard=()=>{},offset=0,cursor,columnOffset=0}){
 const identity=JSON.stringify([ref,table,offset,cursor,columnOffset]);root.dataset.tableRequest=identity;root.setAttribute('aria-busy','true');
 try{
  const page=await call('retained-table',{ref,table,...(cursor?{cursor}:{offset}),columnOffset});guard();if(!root.isConnected||root.dataset.tableRequest!==identity)return;
  const cell=(value,{row,column})=>{
   const selected=page.table.rows[row],window=selected.cellWindows?.[column];if(!window)return esc(value);
   const source={ref,selector:{kind:'cell',page:selected.page,row:selected.row,column:page.columnIndices[column]}};
   return '<button type="button" class="text-button" data-action="material-measurement-inspect" data-source="'+esc(JSON.stringify(source))+'" aria-label="'+esc(tableText('inspect')+': '+page.table.headers[column])+'">'+esc(value||tableText('emptyCell'))+'</button>'+(window.next!==null?'<button type="button" class="text-button" data-table-cell-row="'+(page.offset+row)+'" data-table-cell-column="'+(columnOffset+column)+'">'+esc(tableText('longCell'))+'</button>':'');
  };
  root.innerHTML='<p>'+esc(tableText('range',{start:page.offset+(page.table.rows.length?1:0),end:page.offset+page.table.rows.length,columnStart:page.columnOffset+1,columnEnd:page.columnOffset+page.columnIndices.length,columns:page.columnCount}))+'</p>'+button('previous','data-table-rows="'+Math.max(0,page.offset-16)+'"',!page.offset)+button('next','data-table-rows="'+page.next+'"',page.next===null)+button('previousColumns','data-table-columns="'+Math.max(0,columnOffset-8)+'"',!columnOffset)+button('nextColumns','data-table-columns="'+page.columnNext+'"',page.columnNext===null)+retainedTableView(page.table,esc,{message:tableText,cell})+'<div data-table-cell-window></div>';
  for(const control of root.querySelectorAll('[data-table-rows],[data-table-columns]'))control.onclick=()=>{void paintRetainedTable(root,{call,ref,table,esc,guard,offset:control.hasAttribute('data-table-rows')?Number(control.dataset.tableRows):page.offset,cursor:control.hasAttribute('data-table-rows')?(Number(control.dataset.tableRows)<page.offset?page.previousCursor:page.nextCursor):page.cursor,columnOffset:control.hasAttribute('data-table-columns')?Number(control.dataset.tableColumns):columnOffset}).catch(error=>{if(root.isConnected)root.textContent=error.message;});};
  for(const control of root.querySelectorAll('[data-table-cell-row]'))control.onclick=()=>{void paintCell(root.querySelector('[data-table-cell-window]'),{call,ref,table,esc,guard,rowOffset:Number(control.dataset.tableCellRow),cursor:page.table.rows[Number(control.dataset.tableCellRow)-page.offset].cursor,columnOffset:Number(control.dataset.tableCellColumn)}).catch(error=>{if(root.isConnected)root.querySelector('[data-table-cell-window]').textContent=error.message;});};
 }catch(error){if(root.isConnected&&root.dataset.tableRequest===identity)throw error;}finally{if(root.dataset.tableRequest===identity)root.removeAttribute('aria-busy');}
}
export function retainedTableUI({root,call,esc,field,guard,notify,onTable=()=>{}}){
 let selection=null,source=null,generation=0,schemaOffset=0,schemaRequest=0;
 async function schema(offset){
  const request=generation,pending=++schemaRequest,data=await call('schema',{ref:source,offset,limit:16});guard();if(!root.isConnected||request!==generation||pending!==schemaRequest)return;
  schemaOffset=offset;const region=root.querySelector('[data-table-schema]');
  region.innerHTML=data.items.map((c,i)=>'<label class="material-choice"><input type="checkbox" data-table-column="'+(offset+i)+'"'+(selection.columns==='all'||selection.columns.includes(offset+i)?' checked':'')+(selection.columns==='all'?' disabled':'')+'>'+esc(c.name+(c.unit?' ['+c.unit+']':''))+'</label>').join('')+button('previousColumns','data-schema-page="'+Math.max(0,offset-16)+'"',!offset)+button('nextColumns','data-schema-page="'+data.next+'"',data.next===null);
  for(const control of region.querySelectorAll('[data-schema-page]'))control.onclick=()=>{selected();void schema(Number(control.dataset.schemaPage)).catch(error=>notify(error.message,true));};
 }
 async function load(ref,table,draftSelection){
  const request=++generation;source=ref;schemaOffset=0;root.replaceChildren();if(!ref||ref.kind!=='dataset')return;
  selection=structuredClone(draftSelection??table?.selection??{columns:'all',offset:0,count:null,includeExcluded:false});
  root.innerHTML='<p>'+esc(tableText('help'))+'</p><label><input type="checkbox" data-table-all'+(selection.columns==='all'?' checked':'')+'>'+esc(tableText('allColumns'))+'</label><fieldset><legend>'+esc(tableText('columns'))+'</legend><div data-table-schema></div></fieldset>'+field(esc(tableText('offset')),'<input data-table-offset type="number" min="0" step="1" value="'+selection.offset+'">')+field(esc(tableText('count')),'<input data-table-count type="number" min="1" step="1" value="'+(selection.count??'')+'">')+'<label><input data-table-excluded type="checkbox"'+(selection.includeExcluded?' checked':'')+'>'+esc(tableText('includeExcluded'))+'</label>'+button('load','data-table-load')+'<div data-table-preview></div>';
  root.querySelector('[data-table-all]').onchange=event=>{selection.columns=event.target.checked?'all':[];void schema(schemaOffset).catch(error=>notify(error.message,true));};
  root.querySelector('[data-table-load]').onclick=()=>{void read().then(async table=>{guard();if(root.isConnected){onTable(table);await paintRetainedTable(root.querySelector('[data-table-preview]'),{call,ref:source,table,esc,guard});}}).catch(error=>notify(error.message,true));};
  await schema(0);if(request!==generation||!root.isConnected)return;
  if(table){if(table.version===3)await paintRetainedTable(root.querySelector('[data-table-preview]'),{call,ref:source,table,esc,guard});else root.querySelector('[data-table-preview]').innerHTML=retainedTableView(table,esc,{message:tableText});}
 }
 function selected(){
  if(!selection)return null;
  if(selection.columns!=='all'){
   const next=new Set(selection.columns);for(const control of root.querySelectorAll('[data-table-column]')){const index=Number(control.dataset.tableColumn);if(control.checked)next.add(index);else next.delete(index);}selection.columns=[...next];
  }
  selection={...selection,offset:Number(root.querySelector('[data-table-offset]').value),count:root.querySelector('[data-table-count]').value===''?null:Number(root.querySelector('[data-table-count]').value),includeExcluded:root.querySelector('[data-table-excluded]').checked};return structuredClone(selection);
 }
 async function read(){
  if(!source||!root.querySelector('[data-table-offset]'))throw Error(tableText('invalid'));
  const selectedValue=selected(),request=generation,requested=JSON.stringify(selectedValue),table=await call('retained-table',{ref:source,selection:selectedValue,version:3});
  guard();if(request!==generation||requested!==JSON.stringify(selected()))throw Error(tableText('invalid'));return table;
 }
 return {load,read,selected,stop(){generation++;}};
}
async function paintCell(root,{call,ref,table,esc,guard,rowOffset,cursor,columnOffset,offset=0}){
 const identity=JSON.stringify([ref,table,rowOffset,cursor,columnOffset,offset]);root.dataset.cellRequest=identity;
 const value=await call('retained-table',{ref,table,cell:{rowOffset,cursor,columnOffset,offset}});guard();if(!root.isConnected||root.dataset.cellRequest!==identity)return;
 root.innerHTML='<p>'+esc(value.column.name)+' ('+(offset+1)+'-'+(offset+value.value.length)+' / '+value.total+')</p><pre></pre>'+button('previous','data-cell-offset="'+Math.max(0,offset-4096)+'"',!offset)+button('next','data-cell-offset="'+value.next+'"',value.next===null);
 root.querySelector('pre').textContent=value.value;
 for(const control of root.querySelectorAll('[data-cell-offset]'))control.onclick=()=>{void paintCell(root,{call,ref,table,esc,guard,rowOffset,cursor:value.cursor,columnOffset,offset:Number(control.dataset.cellOffset)}).catch(error=>{if(root.isConnected)root.textContent=error.message;});};
}
