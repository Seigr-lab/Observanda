import {t} from './i18n/index.js';
import {retainedFigureText,escapeFigureText as esc} from './retained-figure-text.js';
import {seriesStyle} from './figure-style.js';
const text=(key,args)=>t('retainedFigureReader',key,args);
const preview=value=>retainedFigureText(value)?value.preview.replace(/[\uD800-\uDBFF]$/,'')+'\u2026':typeof value==='object'?JSON.stringify(value):String(value??'');
const button=(label,action,disabled=false)=>'<button type="button" class="button" data-rf="'+action+'"'+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
const control=(label,key,position,total)=>'<label>'+esc(label)+' <input data-rf-position="'+key+'" type="number" min="1" max="'+Math.max(1,total)+'" value="'+(position+1)+'" inputmode="numeric" style="width:8em"'+(total?'':' disabled')+'></label> '+button(text('go'),key,!total)+' '+button(text('previous'),key+'-previous',!total||position===0)+' '+button(text('next'),key+'-next',!total||position+(key==='observations'?32:1)>=total);
export function retainedFigureReader({root,request,downloadURL,inspectSource=null}){
 let revision=null,controller=new AbortController(),disposed=false,busy=false,panels=0,panel=0,seriesPosition=0,offset=0,plotId=null,header=null,series=null,rows=[],seriesTotal=0,total=0,textSelection=null,textOffset=0,textTotal=0,textNext=null,textHistory=[];
 const current=()=>{controller.signal.throwIfAborted();if(disposed||!root.isConnected)throw new DOMException('Figure reader closed','AbortError');};
 const call=async(operation,fields={})=>{current();const result=await request({operation,...fields,...(revision?{expectedRevision:revision}:{})},{signal:controller.signal});current();if(revision&&result.revision!==revision)throw Error(text('changed'));revision=result.revision;return result;};
 const status=()=>root.querySelector('[data-rf-status]');
 function working(value){busy=value;root.setAttribute('aria-busy',String(value));root.querySelectorAll('button,input').forEach(node=>{if(value){node.dataset.rfDisabled=String(node.disabled);node.disabled=true;}else if(node.dataset.rfDisabled!==undefined){node.disabled=node.dataset.rfDisabled==='true';delete node.dataset.rfDisabled;}});}
 function detailMarkup(){return '<section data-rf-details hidden aria-live="polite"></section>';}
 async function load(){
  const panelPage=await call('window',{selection:{collection:'panels',offset:panel,limit:1}});if(!panelPage.items[0])throw Error(text('invalidRange'));panels=panelPage.total;plotId=panelPage.items[0].plotId??panelPage.items[0].value.plotId;
  const opened=await call('header',{selection:{plotId}});header=opened.header;seriesTotal=opened.counts.series;
  const page=await call('window',{selection:{collection:'series',plotId,offset:seriesPosition,limit:1}});series=page.items[0];if(!series)throw Error(text('invalidRange'));
  const heatmap=header.kind==='heatmap',collection=heatmap?'categories':'points',selection={collection,plotId,...(heatmap?{}:{seriesId:series.id}),offset,limit:32};
  const points=heatmap?await call('cells',{selection:{plotId,seriesId:series.id,offset,limit:32}}):await call('window',{selection});rows=heatmap?points.items.map(({category,point})=>({...category,point})):points.items;total=points.total;
  const drawing=await call('svg',{window:{plotId,seriesOffset:seriesPosition,seriesLimit:1,pointOffset:offset,pointLimit:32}});
  current();root.innerHTML='<div class="inline-actions">'+control(text('panel'),'panel',panel,panels)+'</div><div class="inline-actions">'+control(text('series'),'series',seriesPosition,seriesTotal)+'</div><p><strong>'+esc(preview(series.value.name))+'</strong> '+(retainedFigureText(series.value.name)?button(text('text'),'series-text'):'')+'</p>'+(seriesStyle(series.value).visible?'':'<p>'+esc(text('hidden'))+'</p>')+'<p>'+esc(text(heatmap?'heatmapHelp':'displayHelp'))+'</p><div class="inline-actions">'+control(text(heatmap?'category':'observation'),'observations',offset,total)+'</div><p data-rf-range>'+esc(text('range',{start:total?offset+1:0,end:Math.min(offset+32,total),total}))+'</p><div class="retained-figure-display" tabindex="0" role="region" aria-label="'+esc(text('heading'))+'" style="overflow:auto;max-height:70vh">'+drawing.svg+'</div><div class="material-table" tabindex="0"><table><thead><tr><th>'+esc(text('point'))+'</th><th>'+esc(text('x'))+'</th>'+'<th>'+esc(text('y'))+'</th><th></th>'+'</tr></thead><tbody>'+rows.map((row,index)=>'<tr><th scope="row">'+(row.position+1)+'</th><td>'+esc(preview(heatmap?row.value:row.value.x))+'</td>'+(!heatmap?'<td>'+esc(preview(row.value.y))+'</td><td>'+button(text('inspect'),'point-'+index)+'</td>':'<td>'+esc(row.point?preview(row.point.value.y):text('missing'))+'</td><td>'+button(text('text'),'category-'+index)+(row.point?button(text('inspect'),'point-'+index):'')+'</td>')+'</tr>').join('')+'</tbody></table></div>'+(!rows.length?'<p>'+esc(text('empty'))+'</p>':'')+'<div class="inline-actions">'+['title','x.label','y.label'].filter(key=>retainedFigureText(key==='title'?header.title:header[key[0]]?.label)).map(key=>button(text('text')+': '+key,'header-'+key)).join('')+'</div><p>'+esc(text('download'))+'</p><div class="inline-actions">'+['svg','csv','json'].map(format=>'<a class="button" download href="'+esc(downloadURL(format,revision))+'">'+esc(text(format))+'</a>').join('')+'</div>'+detailMarkup()+'<p data-rf-status role="status"></p>';
 }
 async function showText(selection,at=0){
  if(at===0)textHistory=[];
  const result=await call('text',{selection:{...selection,offset:at,limit:4096}});textSelection=selection;textOffset=at;textTotal=result.total;
  let value=result.text;if(typeof value!=='string')throw Error('Invalid retained text response');if(/[\uD800-\uDBFF]$/.test(value)&&at+value.length<textTotal){const tail=await call('text',{selection:{...selection,offset:at+value.length,limit:1}});value+=tail.text;}textNext=at+value.length<textTotal?at+value.length:null;const host=root.querySelector('[data-rf-details]');host.hidden=false;host.innerHTML='<h3>'+esc(text('text'))+'</h3><p>'+esc(text('range',{start:at+1,end:at+value.length,total:textTotal}))+'</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(value)+'</pre><div class="inline-actions">'+button(text('previous'),'text-previous',at===0)+button(text('next'),'text-next',at+value.length>=textTotal)+button(text('close'),'details-close')+'</div>';host.scrollIntoView({block:'nearest'});
 }
 async function showPoint(index){
  const row=header.kind==='heatmap'?rows[index]?.point:rows[index];if(!row)throw Error(text('invalidRange'));const result=await call('item',{selection:{collection:'points',plotId,seriesId:series.id,id:row.id}}),item=result.item;if(!item)throw Error(text('invalidRange'));
  const host=root.querySelector('[data-rf-details]');host.hidden=false;host.dataset.pointId=item.id;host.innerHTML='<h3>'+esc(text('details'))+' '+(item.position+1)+'</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(item.value,null,2))+'</pre>'+(retainedFigureText(item.value.x)?button(text('text'),'point-text-'+index):'')+(inspectSource?button(text('source'),'point-source-'+index):'')+button(text('close'),'details-close');host.scrollIntoView({block:'nearest'});
 }
 async function action(event){
  const node=event.target.closest('[data-rf]');if(!node||!root.contains(node)||busy)return;event.preventDefault();const name=node.dataset.rf,previous={panel,seriesPosition,offset,plotId,header,series,rows,seriesTotal,total};working(true);
  try{
   if(name==='details-close'){root.querySelector('[data-rf-details]').hidden=true;return;}
   if(name==='series-text')return await showText({collection:'series',plotId,id:series.id,field:'name'});
   if(name.startsWith('header-'))return await showText({collection:'header',plotId,id:plotId,field:name.slice(7)});
   if(name.startsWith('point-source-'))return await inspectSource({plotId,seriesId:series.id,pointId:(header.kind==='heatmap'?rows[Number(name.slice(13))].point:rows[Number(name.slice(13))]).id});
   if(name.startsWith('point-text-'))return await showText({collection:'points',plotId,seriesId:series.id,id:(header.kind==='heatmap'?rows[Number(name.slice(11))].point:rows[Number(name.slice(11))]).id,field:'x'});
   if(name.startsWith('point-'))return await showPoint(Number(name.slice(6)));
   if(name.startsWith('category-'))return await showText({collection:'categories',plotId,id:rows[Number(name.slice(9))].id,field:'value'});
   if(name==='text-previous'){return await showText(textSelection,textHistory.pop()??0);}
   if(name==='text-next'){textHistory.push(textOffset);return await showText(textSelection,textNext);}
   textHistory=[];
   const key=name.split('-')[0],old=key==='panel'?panel:key==='series'?seriesPosition:offset,limit=key==='panel'?panels:key==='series'?seriesTotal:total,step=key==='observations'?32:1;
   const position=name.endsWith('-previous')?Math.max(0,old-step):name.endsWith('-next')?old+step:Number(root.querySelector('[data-rf-position="'+key+'"]').value)-1;
   if(!Number.isSafeInteger(position)||position<0||position>=limit)throw Error(text('invalidRange'));
   if(key==='panel'){panel=position;seriesPosition=0;offset=0;}else if(key==='series'){seriesPosition=position;offset=0;}else offset=position;
   await load();
  }catch(error){({panel,seriesPosition,offset,plotId,header,series,rows,seriesTotal,total}=previous);if(error.name!=='AbortError'&&status())status().textContent=error.message;}
  finally{if(!disposed)working(false);}
 }
 root.innerHTML='<p data-rf-status role="status">'+esc(text('loading'))+'</p>';root.addEventListener('click',action);
 const ready=(async()=>{working(true);try{await load();}catch(error){if(error.name!=='AbortError'&&status())status().textContent=error.message;throw error;}finally{if(!disposed)working(false);}})();
 return {ready,dispose(){disposed=true;controller.abort();root.removeEventListener('click',action);}};
}
