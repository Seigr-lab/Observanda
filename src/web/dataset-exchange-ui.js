import {t} from './i18n/index.js';
import './i18n/catalogues/datasetExchange.js';
export const exchangeText=(key,params)=>t('datasetExchange',key,params);
const sizeText=n=>n.toLocaleString(document.documentElement.lang);

function merge(ranges){
 const merged=[];
 for(const item of [...ranges].sort((a,b)=>a.offset-b.offset)){
  const last=merged.at(-1);
  if(last&&last.offset+last.count>=item.offset)last.count=Math.max(last.offset+last.count,item.offset+item.count)-last.offset;
  else merged.push({...item});
 }
 return merged;
}
function toggle(ranges,index,checked){
 if(checked)return merge([...ranges,{offset:index,count:1}]);
 return ranges.flatMap(range=>{
  const end=range.offset+range.count;if(index<range.offset||index>=end)return [range];
  return [{offset:range.offset,count:index-range.offset},{offset:index+1,count:end-index-1}].filter(item=>item.count);
 });
}

export function datasetExchangeUI({call,frame,esc,field,button,guard,owner,scope,watch,download,queueDataset}){
 let current=null;
 let importSource=null;
 const label=key=>esc(exchangeText(key));
 const progress=id=>'data-job="'+esc(id)+'"';
 const panel=()=>document.getElementById('dataset-exchange');
 async function columns(offset){
  const context=current,host=panel();if(!context||!host)return;
  const request=++context.request;
  const {items,total}=await call('schema',{ref:context.ref,offset,limit:16},{adopt:false});
  guard();if(current!==context||!host.isConnected||request!==context.request)return;
  context.offset=offset;
  const container=host.querySelector('[data-columns]');
  container.innerHTML=items.map((column,i)=>{
   const index=offset+i,checked=context.ranges.some(range=>index>=range.offset&&index<range.offset+range.count);
   return '<label><input type="checkbox" data-column="'+index+'" '+(checked?'checked':'')+'> '+esc(column.name)+' <small>('+sizeText(index+1)+')</small></label>';
  }).join('');
  host.querySelector('[data-window]').textContent=exchangeText('window',{from:sizeText(offset+1),to:sizeText(offset+items.length),total:sizeText(total)});
  host.querySelector('[data-action="material-exchange-prev"]').disabled=offset===0;
  host.querySelector('[data-action="material-exchange-next"]').disabled=offset+items.length>=total;
 }
 function renderRanges(){
  const host=panel();
  const ranges=current.ranges.map(({offset,count})=>count===1?sizeText(offset+1):sizeText(offset+1)+'–'+sizeText(offset+count));
  const display=ranges.slice(0,12).join(', ');
  host.querySelector('[data-ranges]').textContent=ranges.length?exchangeText('selected',{count:sizeText(current.ranges.reduce((n,r)=>n+r.count,0)),ranges:display+(ranges.length>12?'…':'')}):exchangeText('empty');
  for(const box of host.querySelectorAll('[data-column]')){
   const index=Number(box.dataset.column);
   box.checked=current.ranges.some(range=>index>=range.offset&&index<range.offset+range.count);
  }
 }
 function open(doc,ref){
  guard();const width=doc.content.schemaIndex?.count??doc.content.columns?.length,rows=doc.content.rowCount;
  current={ref:{...ref,workspaceId:ref.workspaceId??scope()},width,rows,ranges:[],offset:0,request:0,intent:null};
  const number=(key,max,value)=>field(label(key),'<input data-'+key+' type="number" min="1" max="'+max+'" value="'+value+'" required>');
  frame(exchangeText('heading'),'<div id="dataset-exchange"><p>'+esc(doc.title)+' · '+esc(exchangeText('counts',{rows:sizeText(rows),columns:sizeText(width)}))+'</p>'+
   '<div class="material-fields">'+field(label('format'),'<select data-format><option value="csv">CSV</option><option value="tsv">TSV</option></select>')+
   field(label('rows'),'<select data-rows><option value="all">'+label('allRows')+'</option><option value="range" '+(rows?'':'disabled')+'>'+label('range')+'</option></select>')+
   '</div><div class="material-fields" data-row-range hidden>'+number('from',rows,1)+number('to',rows,rows)+'</div>'+
   '<label><input type="checkbox" data-excluded checked> '+label('excluded')+'</label>'+
   field(label('columns'),'<select data-mode><option value="all">'+label('allColumns')+'</option><option value="selected">'+label('choose')+'</option></select>')+
   '<fieldset data-picker hidden><legend>'+label('choose')+'</legend><p data-ranges role="status"></p><div class="material-fields">'+number('first',width,1)+number('last',width,width)+'</div>'+button(label('addRange'),'exchange-range')+
   '<div class="material-fields" data-columns></div><div class="inline-actions">'+button(label('previous'),'exchange-prev','disabled')+'<span data-window></span>'+button(label('next'),'exchange-next','disabled')+'</div></fieldset>'+
   '<p>'+label('contents')+'</p><p>'+label('formula')+'</p><p data-error role="alert"></p>'+button(label('prepare'),'exchange-start')+'</div>');
  const host=panel();
  host.onchange=async event=>{
   if(event.target.matches('[data-rows]'))host.querySelector('[data-row-range]').hidden=event.target.value==='all';
   if(event.target.matches('[data-mode]')){
    const chosen=event.target.value==='selected';host.querySelector('[data-picker]').hidden=!chosen;
    if(chosen){renderRanges();try{await columns(current.offset);}catch(error){if(host.isConnected)host.querySelector('[data-error]').textContent=error.message;}}
   }
   if(event.target.matches('[data-column]')){current.ranges=toggle(current.ranges,Number(event.target.dataset.column),event.target.checked);renderRanges();}
  };
 }
 function openImport(doc,ref){
  guard();importSource={...ref};
  frame(exchangeText('importHeading'),'<p>'+label('importHelp')+'</p><p>'+esc(doc.title)+'</p>'+field(label('importTitle'),'<input id="exchange-import-title" required maxlength="300" value="'+esc(doc.title.replace(/\.(?:jsonl|ndjson)$/i,''))+'">'),button(label('importHeading'),'exchange-import-confirm'));
  document.getElementById('exchange-import-title').focus();
 }
 async function action(act,control){
  if(!act.startsWith('exchange-'))return false;
  guard();
  if(act==='exchange-import-confirm'){
   const input=document.getElementById('exchange-import-title');if(!importSource||!input?.reportValidity())return true;
   const command={recordId:owner(),title:input.value.trim(),artifact:importSource,exchangeImport:1};
   control.disabled=true;
   try{const {job}=await queueDataset(command);guard();if(control.isConnected)await watch(job);}finally{if(control.isConnected)control.disabled=false;}
   return true;
  }
  if(act==='exchange-download'){await download(control.dataset.job);return true;}
  if(act==='exchange-discard'){
   control.disabled=true;try{await call('dataset-exchange-discard',{id:control.dataset.job,recordId:owner()});frame(exchangeText('heading'),'<p role="status">'+label('discarded')+'</p>');}finally{if(control.isConnected)control.disabled=false;}return true;
  }
  const host=panel();if(!host||!current)return true;
  const error=host.querySelector('[data-error]');error.textContent='';
  if(act==='exchange-prev'||act==='exchange-next'){await columns(current.offset+(act==='exchange-prev'?-16:16));return true;}
  const integer=key=>host.querySelector('[data-'+key+']').valueAsNumber;
  const range=(begin,end,max)=>{const from=integer(begin),to=integer(end);return Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from>=1&&to>=from&&to<=max?{offset:from-1,count:to-from+1}:null;};
  if(act==='exchange-range'){
   const add=range('first','last',current.width);
   if(!add)error.textContent=exchangeText('invalidRange');else{current.ranges=merge([...current.ranges,add]);renderRanges();}return true;
  }
  if(act==='exchange-start'){
   const rows=host.querySelector('[data-rows]').value==='all'?{offset:0,count:null}:range('from','to',current.rows);
   const selected=host.querySelector('[data-mode]').value==='all'?null:current.ranges;
   if(!rows||selected?.length===0){error.textContent=exchangeText(!rows?'invalidRange':'empty');return true;}
   const command={recordId:owner(),ref:current.ref,format:host.querySelector('[data-format]').value,selection:{...rows,columns:selected,includeExcluded:host.querySelector('[data-excluded]').checked}};
   const key=JSON.stringify(command);if(current.intent?.key!==key)current.intent={key,id:crypto.randomUUID()};
   control.disabled=true;
   try{const result=await call('dataset-exchange-start',{jobId:current.intent.id,...command});guard();if(host.isConnected)await watch(result.job);}
   finally{if(control.isConnected)control.disabled=false;}
  }
  return true;
 }
 async function completed(job,active){
  const {available}=await call('dataset-exchange-status',{id:job.id,recordId:owner()},{adopt:false});guard();if(!active())return;
  frame(exchangeText('heading'),available?'<p role="status">'+label('ready')+'</p><p>'+label('contents')+'</p><div class="inline-actions">'+button(label('download'),'exchange-download',progress(job.id))+button(label('discard'),'exchange-discard',progress(job.id))+'</div>':'<p role="status">'+label('unavailable')+'</p>');
 }
 return {open,openImport,action,completed};
}
