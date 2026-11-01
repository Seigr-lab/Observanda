import {isRetainedFigure} from './retained-figure-model.js';
import {escapeFigureText as esc} from './retained-figure-text.js';
import {t} from './i18n/index.js';
import {renderFigure} from './figure-presentation.js';
import {figureStyle} from './figure-style.js';
import {figurePreviewWindow} from './figure-preview-window.js';
const text=(key,values)=>t('retainedFigureReader',key,values);

// A single responsive mounting layer for both saved and proposed figures.
// Width is measured in CSS pixels, so text does not grow with a stretched SVG.
export function figurePreviews(){
 const mounted=new Map();
 const observer=new ResizeObserver(entries=>{
  for(const {target,contentRect} of entries){
   const item=mounted.get(target);
   if(item&&Math.abs(item.width-contentRect.width)>1)draw(target,item,contentRect.width);
  }
 });
 function draw(host,item,width){
  if(width<1)return;
  if(isRetainedFigure(item.figure)){item.width=width;host.innerHTML=item.figure.source?'<button type="button" class="button" data-action="material-figure-source" data-ref="'+esc(JSON.stringify(item.figure.source))+'">'+esc(t('retainedFigureReader','open'))+'</button>':'<p>'+esc(t('retainedFigureReader','heading'))+'</p>';return;}
  const page=item.window.view(width),style=figureStyle(page.figure),button=(key,label,disabled=false)=>'<button type="button" class="button" data-figure-preview="'+key+'"'+(disabled?' disabled':'')+'>'+esc(text(label))+'</button>',control=(kind,label,position,total,step=1)=>'<div class="inline-actions"><label>'+esc(text(label))+' <input data-figure-preview-position="'+kind+'" type="number" min="1" max="'+Math.max(1,total)+'" value="'+(position+1)+'" style="width:7em"'+(!total?' disabled':'')+'></label>'+button(kind,'go',!total)+button(kind+'-previous','previous',!total||position===0)+button(kind+'-next','next',!total||position+step>=total)+'</div>';
  item.width=width;item.page=page;
  const controls=page.paged?'<div data-figure-preview-controls><p>'+esc(text('previewWindowHelp'))+'</p>'+(page.panels>1?control('panel','panel',page.panel,page.panels)+'<p>'+esc(page.panelLabel)+'</p>':'')+(page.seriesCount>1?control('series','series',page.series,page.seriesCount):'')+'<p><strong>'+esc(page.name)+'</strong></p>'+control('observations',page.heatmap?'category':'observation',page.offset,page.total,page.limit)+'<p data-figure-preview-range role="status">'+esc(text('range',{start:page.total?page.offset+1:0,end:Math.min(page.offset+page.limit,page.total),total:page.total}))+'</p>'+(page.hidden?'<p>'+esc(text('hidden'))+'</p>':'')+'</div>':'';
  host.innerHTML=controls+'<div data-figure-preview-drawing style="overflow:auto">'+renderFigure(page.figure,{width:Math.max(280,Math.floor(width)),height:Math.max(260,Math.min(style.height,width*style.height/style.width)),idPrefix:item.prefix})+'</div>';
  host.classList.toggle('is-tall-preview',host.getBoundingClientRect().height>window.innerHeight-180);
 }
 function prune(){
  for(const host of mounted.keys())if(!host.isConnected)release(host);
 }
 function release(host){const item=mounted.get(host);if(!item)return;host.removeEventListener('click',item.action);observer.unobserve(host);mounted.delete(host);}
 function mount(host,figure,prefix='preview'){
  if(!host)return;
  prune();release(host);const item={figure,prefix,width:0,window:isRetainedFigure(figure)?null:figurePreviewWindow(figure),action:event=>{
   const button=event.target.closest('[data-figure-preview]');if(!button||!host.contains(button)||!item.page?.paged)return;event.preventDefault();event.stopPropagation();const action=button.dataset.figurePreview,kind=action.split('-')[0],page=item.page,previous=kind==='panel'?page.panel:kind==='series'?page.series:page.offset,step=kind==='observations'?page.limit:1;
   const position=action.endsWith('-previous')?Math.max(0,previous-step):action.endsWith('-next')?previous+step:Number(host.querySelector('[data-figure-preview-position="'+kind+'"]').value)-1;
   if(item.window.select(kind,position,item.width)){draw(host,item,item.width);host.querySelector('[data-figure-preview="'+action+'"]')?.focus();}
  }};mounted.set(host,item);host.addEventListener('click',item.action);
  draw(host,item,host.getBoundingClientRect().width);observer.observe(host);
 }
 return {mount,prune,release(host){if(host)release(host);else{for(const host of [...mounted.keys()])release(host);observer.disconnect();}}};
}
