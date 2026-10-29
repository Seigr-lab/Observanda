import {isRetainedFigure} from './retained-figure-model.js';
import {allFigurePlots} from './figure-provenance.js';
import {retainedFigureText} from './retained-figure-text.js';
import {t} from './i18n/index.js';
import {renderFigureView,figureTable} from './figure-renderer.js';
import {figureResultView} from './result-statements.js';
import {bookText} from './book-messages.js';
import {figureSourceView} from './figure-provenance-ui.js';
import {figureReadingView} from './figure-reading-view.js';
// Several revisions of the same figure can be visible together. SVG fragment
// references are document-wide, so each read-only rendering needs its own
// namespace. This presentation identity never enters the saved record/export.
let figureViewSequence=0;
export function recordFigure(record,id,esc,{assetUrl=id=>'/api/media/'+id,figureSources=true,figureActions=()=>'',figureResults=null,figureReference=null,retainedFigureAction=null,translate}={}){
 const f=allFigurePlots(record.figures).find(f=>f.id===id);
 if(f?.kind==='panels'&&f.panels.some(panel=>isRetainedFigure(panel.figure)))return '<figure id="record-figure-'+f.id+'" tabindex="-1"><figcaption>'+esc(f.title)+(figureResults?figureResults(f):figureResultView(f,record.results,esc))+(figureSources?figureSourceView(f,esc):'')+'</figcaption><div class="figure-panel-grid figure-columns-'+f.layout.columns+'">'+f.panels.map(panel=>'<section class="figure-panel"><h4>'+esc(panel.label)+'</h4>'+recordFigure(record,panel.figure.id,esc,{assetUrl,figureSources,figureActions,figureResults,figureReference,retainedFigureAction,translate})+'</section>').join('')+'</div>'+figureActions(f)+'</figure>';
 if(isRetainedFigure(f)){
  const title=retainedFigureText(f.title)?f.title.preview+'\u2026':f.title;
  return '<figure id="record-figure-'+f.id+'" tabindex="-1"><figcaption>'+esc(title)+(figureResults?figureResults(f):figureResultView(f,record.results,esc))+(figureSources?figureSourceView(f,esc):'')+'</figcaption>'+(retainedFigureAction?retainedFigureAction(f):'<button type="button" class="button" data-action="material-retained-figure" data-record-id="'+esc(record.id)+'" data-figure-id="'+esc(f.id)+'"'+(f.source?' data-figure-source="'+esc(JSON.stringify(f.source))+'"':'')+(figureReference?' data-figure-ref="'+esc(JSON.stringify(figureReference))+'"':'')+'>'+esc(t('retainedFigureReader','open'))+'</button>')+figureActions(f)+'</figure>';
 }if(f)return '<figure id="record-figure-'+f.id+'" tabindex="-1">'+figureReadingView(renderFigureView(f,{idPrefix:'record-view-'+ ++figureViewSequence,translate}),f.title)+'<figcaption>'+esc(f.title)+(figureResults?figureResults(f):figureResultView(f,record.results,esc))+(figureSources?figureSourceView(f,esc):'')+'</figcaption><details><summary>'+esc(bookText('tableReading'))+'</summary>'+figureTable(f,{translate})+'</details>'+figureActions(f)+'</figure>';
 const a=record.attachments.find(a=>a.id===id&&a.kind==='image');if(!a)return '';
 return '<figure id="record-figure-'+a.id+'" tabindex="-1"><img src="'+esc(assetUrl(a.id))+'" alt="'+esc(a.alt||a.caption)+'"><figcaption>'+esc(a.caption)+'</figcaption>'+(a.transcript?'<div class="book-diagram-reading">'+esc(a.transcript)+'</div>':'')+'</figure>';
}
export function recordFigureRenderer(record,esc,options){
 const shown=new Set();return id=>recordFigure(record,id,esc,options).replace(/ id="record-figure-([a-f0-9-]+)"/g,(attribute,figureId)=>{if(shown.has(figureId))return '';shown.add(figureId);return attribute;});
}
