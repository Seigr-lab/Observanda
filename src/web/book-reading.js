import {renderFigureView,figureTable} from './figure-renderer.js';
import {figureResultView} from './result-statements.js';
import {bookText} from './book-messages.js';
import {figureSourceView} from './figure-provenance-ui.js';
import {figureReadingView} from './figure-reading-view.js';
// Several revisions of the same figure can be visible together. SVG fragment
// references are document-wide, so each read-only rendering needs its own
// namespace. This presentation identity never enters the saved record/export.
let figureViewSequence=0;
export function recordFigure(record,id,esc,{assetUrl=id=>'/api/media/'+id,figureSources=true,figureActions=()=>''}={}){
 const f=record.figures.find(f=>f.id===id);if(f)return '<figure id="record-figure-'+f.id+'" tabindex="-1">'+figureReadingView(renderFigureView(f,{idPrefix:'record-view-'+ ++figureViewSequence}),f.title)+'<figcaption>'+esc(f.title)+figureResultView(f,record.results,esc)+(figureSources?figureSourceView(f,esc):'')+'</figcaption><details><summary>'+esc(bookText('tableReading'))+'</summary>'+figureTable(f)+'</details>'+figureActions(f)+'</figure>';
 const a=record.attachments.find(a=>a.id===id&&a.kind==='image');if(!a)return '';
 return '<figure id="record-figure-'+a.id+'" tabindex="-1"><img src="'+esc(assetUrl(a.id))+'" alt="'+esc(a.alt||a.caption)+'"><figcaption>'+esc(a.caption)+'</figcaption>'+(a.transcript?'<div class="book-diagram-reading">'+esc(a.transcript)+'</div>':'')+'</figure>';
}
export function recordFigureRenderer(record,esc,options){
 const shown=new Set();return id=>{let html=recordFigure(record,id,esc,options);if(shown.has(id))html=html.replace(' id="record-figure-'+id+'"','');shown.add(id);return html;};
}
