import {recordRevisionView} from './record-revision-view.js';
import {t} from './i18n/index.js';
import {figureResultLinks} from './figure-result-links.js';
const text=(key,args)=>t('recordHistory',key,args);
export function historyReadingPage(page,esc,options={}){
 const record=page.record,inlineRecord={...record,figures:[...record.figures,...page.inline.figures],attachments:[...record.attachments,...page.inline.attachments]};
 return recordRevisionView(record,esc,{...options,inlineRecord,attemptWindow:page.attemptWindow,figureResults:figure=>figureResultLinks(figure,page.resultFigures,esc,{action:'record-history-results-figure'})});
}
export function historyReadingControls(review,collection,esc){
 const first=collection==='sections'?review.previous.sections:review.previous.collections[collection],next=collection==='sections'?review.next.sections:review.next.collections[collection];
 const total=Math.max(first?.total??0,next?.total??0),offset=Math.max(first?.offset??0,next?.offset??0);
 const names=['sections','contributors','relations','figures','attachments','tags','fields','preparations','events','assessments','results'];
 const button=(label,action,disabled)=>'<button type="button" class="button" data-action="record-history-content-'+action+'"'+(disabled?' disabled':'')+'>'+esc(text(label))+'</button>';
 return '<div data-history-reading-controls>'+(review.previous.resultWindow?.figureId?'<div class="inline-actions"><p>'+esc(text('resultsForFigure'))+'</p><button type="button" class="button" data-action="record-history-results-all">'+esc(text('allResults'))+'</button></div>':'')+'<nav class="record-section-navigation" aria-label="'+esc(text('contentNavigation'))+'"><label>'+esc(text('contentCollection'))+'<select data-history-collection>'+names.map(name=>'<option value="'+name+'"'+(collection===name?' selected':'')+'>'+esc(text('field_'+(name==='fields'?'template':name)))+'</option>').join('')+'</select></label><span role="status">'+esc(text('contentRange',{first:total?offset+1:0,last:Math.min(offset+4,total),total}))+'</span><div class="inline-actions">'+button('contentPrevious','previous',!offset)+button('contentNext','next',offset+4>=total)+'</div><label>'+esc(text('contentGoTo'))+'<input data-history-position type="number" required min="1" max="'+Math.max(1,total)+'" value="'+(offset+1)+'"></label>'+button('contentGo','go',!total)+'</nav></div>';
}
