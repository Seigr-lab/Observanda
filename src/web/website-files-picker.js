import {t} from './i18n/index.js';

const pageSize=12;
export function websiteFilesPicker({request,esc,render,blocks,insert}){
 const msg=(key,data)=>t('websiteFiles',key,data);
 let open=false,search='',filter='all',query='',applied='all',pages=[null],page=0,rows=[],next=null;
 let selected=null,preview='',position='end',blockNumber=1,epoch=0,controller=null;
 const button=(label,op,extra='')=>'<button type="button" class="button" data-action="website-files-picker-'+op+'" '+extra+'>'+esc(msg(label))+'</button>';
 const option=(value,label,choice)=>'<option value="'+value+'" '+(choice===value?'selected':'')+'>'+esc(msg(label))+'</option>';
 function reset(){
  controller?.abort();controller=null;epoch++;open=false;search=query='';filter=applied='all';pages=[null];page=0;rows=[];next=null;selected=null;preview='';position='end';blockNumber=1;
 }
 async function fetchPage(after,index){
  controller?.abort();controller=new AbortController();
  const current=++epoch,items=[];let cursor=after;
  for(let window=0;window<3;window++){
   const data=await request('library/search',{search:query,filter:applied,limit:pageSize-items.length,after:cursor},{signal:controller.signal});
   if(current!==epoch)return;
   items.push(...data.items);cursor=data.next;
   if(!cursor||items.length===pageSize)break;
  }
  rows=items;next=cursor;page=index;pages[index]=after;selected=null;preview='';render();
 }
 function reference(item){return msg('pickerReference',{id:item.recordId??item.id});}
 function view(){
  const header='<h2>'+esc(msg('library'))+'</h2><p>'+esc(msg('libraryNotice'))+'</p>';
  if(!open)return '<section class="panel website-files-picker">'+header+button('pickerBrowse','open')+'</section>';
  const selection=selected&&rows.find(item=>item.id===selected),labels=selection&&position==='before'?blocks():[];
  const form='<label>'+esc(msg('pickerSearch'))+'<input type="search" maxlength="160" data-picker-search value="'+esc(search)+'"></label>'+
   '<label>'+esc(msg('pickerFilter'))+'<select data-picker-filter>'+option('all','pickerAll',filter)+option('media','pickerWithMedia',filter)+option('text','pickerTextOnly',filter)+'</select></label>'+button('pickerFind','search');
  const results=rows.map(item=>'<li><strong>'+esc(item.title)+'</strong><small>'+esc(reference(item))+'</small>'+(item.preview?'<p>'+esc(item.preview)+'</p>':'')+
   button('pickerPreview','select','data-source="'+esc(item.id)+'" aria-pressed="'+String(selected===item.id)+'"')+'</li>').join('');
  const positionField='<label>'+esc(msg('pickerPosition'))+'<select data-picker-position>'+option('end','pickerEnd',position)+option('start','pickerStart',position)+option('before','pickerBefore',position)+'</select></label>';
  const number=position==='before'?'<label>'+esc(msg('pickerBlockNumber'))+'<input type="number" data-picker-block min="1" max="'+labels.length+'" value="'+esc(String(blockNumber))+'"></label><span data-picker-block-label>'+esc(labels[blockNumber-1]??'')+'</span>':'';
  const detail=selection?'<section class="website-picker-selection"><h3>'+esc(selection.title)+'</h3>'+(!selection.preview&&preview?'<p>'+esc(preview)+'</p>':'')+positionField+number+button('pickerInsert','insert','data-website-file-requires-clean')+'</section>':'';
  return '<section class="panel website-files-picker" data-website-picker>'+header+form+'<p role="status">'+esc(msg('pickerPage',{page:page+1}))+'</p>'+
   (rows.length?'<ul class="website-picker-results">'+results+'</ul>':next?'':'<p>'+esc(msg(query||applied!=='all'?'pickerNoMatches':'emptyLibrary'))+'</p>')+
   '<div class="inline-actions">'+(page?button('pickerPrevious','previous'):'')+(next?button(rows.length?'pickerNext':'pickerContinue','next'):'')+'</div>'+detail+button('pickerClose','close')+'</section>';
 }
 function input(el){
  if(el.matches('[data-picker-search]')){search=el.value;return true;}
  if(el.matches('[data-picker-filter]')){filter=el.value;return true;}
  if(el.matches('[data-picker-position]')){position=el.value;blockNumber=1;render();return true;}
  if(el.matches('[data-picker-block]')){blockNumber=el.valueAsNumber;const label=el.closest('[data-website-picker]')?.querySelector('[data-picker-block-label]');if(label)label.textContent=blocks()[blockNumber-1]??'';return true;}
  return false;
 }
 async function action(operation,element){
  if(!operation?.startsWith('picker-'))return false;
  if(operation==='picker-close'){reset();render();return true;}
  if(operation==='picker-open'||operation==='picker-search'){open=true;query=search.trim();applied=filter;pages=[null];await fetchPage(null,0);}
  else if(operation==='picker-previous'&&page>0)await fetchPage(pages[page-1],page-1);
  else if(operation==='picker-next'&&next!==null)await fetchPage(next,page+1);
  else if(operation==='picker-select'){
   const item=rows.find(row=>row.id===element.dataset.source);if(!item)return true;
   const current=++epoch,value=await request('library/preview',{sourceId:item.id,sourceRevision:item.revision},{signal:controller?.signal});
   if(current!==epoch)return true;selected=item.id;preview=value.preview;render();
  }else if(operation==='picker-insert'){
   const item=rows.find(row=>row.id===selected);if(!item)return true;
   if(position==='before'&&(!Number.isInteger(blockNumber)||blockNumber<1||blockNumber>blocks().length))throw Error(msg('pickerBlockNumber'));
   await insert({sourceId:item.id,sourceRevision:item.revision,position:position==='before'?{before:blockNumber-1}:position});selected=null;preview='';render();
  }
  return true;
 }
 function bind(){
  const field=document.querySelector('[data-picker-search]');if(!field)return;
  field.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();field.closest('[data-website-picker]').querySelector('[data-action="website-files-picker-search"]').click();}};
 }
 return {view,input,action,reset,bind};
}
