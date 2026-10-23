// Shared read-only presentation for record history and exact research references.
import {recordDateLabel} from './record-date.js';
import {sectionAnchor} from './record-workflow.js';
import {renderProse} from './prose-model.js';
import {RECORD_TYPES} from './record-types.js';
import {revisionText} from './revision-model.js';
import {attemptView} from './attempt-view.js';
import {resultStatementsView} from './result-statements.js';
import {analysisText as atext} from './analysis-messages.js';
import {attemptText} from './attempt-messages.js';
import {recordFigure,recordFigureRenderer} from './book-reading.js';
import {placedFigures} from './book-selectors.js';
import {customFieldLabel} from './custom-field-presentation.js';

const labels={title:'Title',type:'Record type',status:'Progress',outcome:'Outcome',occurredOn:'Record date',body:'Summary / context',sections:'Writing sections',template:'Record fields',tags:'Tags',contributors:'Contributors',relations:'Research links',figures:'Figures',attachments:'Media',notebookId:'Lab book',share:'Website selection',attempt:attemptText('title'),results:atext('results')};
const same=(a,b)=>revisionText(a??null)===revisionText(b??null);
export const recordChanges=(previous,current)=>Object.keys(labels).filter(key=>!same(previous[key],current[key])).map(key=>({key,label:labels[key]}));
const typeName=record=>record.template?.label??RECORD_TYPES.find(t=>t.id===record.type)?.label??record.type;
const value=(v,esc)=>v?.type==='doc'?renderProse(v):esc(typeof v==='object'?JSON.stringify(v):String(v??''));

export function recordRevisionField(key,record,esc,{anchors=false,assetUrl=id=>'/api/media/'+id,figureSources=true,figureActions,figureResults=null,figureReference=null,retainedFigureAction=null,figure=recordFigureRenderer(record,esc,{assetUrl,figureSources,figureActions,figureResults,figureReference,retainedFigureAction})}={}){
 const prose=v=>renderProse(v,{figure});
 if(key==='results')return resultStatementsView(record.results,esc);
 if(key==='attempt')return attemptView(record.attempt,esc);
 const v=record[key],list=items=>items.length?'<ul>'+items.map(item=>'<li>'+item+'</li>').join('')+'</ul>':'<p class="muted">None</p>';
 if(key==='body')return prose(v);
 if(key==='sections')return v.map(s=>'<section'+(anchors?' id="'+esc(sectionAnchor(s))+'"':'')+'><h2>'+esc(s.title)+'</h2>'+prose(s.body)+'</section>').join('')||'<p>No writing sections</p>';
 if(key==='figures')return v.filter(f=>!placedFigures(record).has(f.id)).map(f=>recordFigure(record,f.id,esc,{assetUrl,figureSources,figureActions,figureResults,figureReference,retainedFigureAction})).join('');
 if(key==='occurredOn')return esc(recordDateLabel(v));
 if(key==='type')return esc(typeName(record));
 if(key==='share')return record.share?'Included in website':'Private';
 if(key==='tags')return list(v.map(t=>esc(t)));
 if(key==='contributors')return list(v.map(p=>esc(p.name)+(p.role?' &middot; '+esc(p.role):'')));
 if(key==='relations')return list(v.map(r=>esc(r.type)+' &middot; '+esc(r.label||'Linked item')+(r.target.revision?' (exact revision '+esc(r.target.revision.slice(0,12))+')':' (current item)')));
 if(key==='attachments')return v.filter(a=>!placedFigures(record).has(a.id)).map(a=>a.kind==='image'?recordFigure(record,a.id,esc,{assetUrl,figureSources}):'<figure><'+a.kind+' src="'+esc(assetUrl(a.id))+'" controls preload="metadata" aria-label="'+esc(a.alt||a.caption||a.kind)+'"></'+a.kind+'><figcaption>'+esc(a.caption)+'</figcaption><div class="result-statement-text">'+esc(a.transcript)+'</div></figure>').join('');
 if(key==='template')return v?'<p>'+esc(v.label)+'</p><dl>'+v.fields.map(f=>'<dt>'+esc(customFieldLabel(f))+'</dt><dd>'+value(v.values[f.key],esc)+'</dd>').join('')+'</dl>':'<p>No custom record fields</p>';
 return value(v,esc);
}
export function recordRevisionView(record,esc,{relations=true,anchors=false,sectionsHtml=null,fieldsHtml={},inlineRecord=record,attemptReference=null,attemptWindow=null,resultReference=null,assetUrl=id=>'/api/media/'+id,figureSources=true,figureActions,figureResults=null,figureReference=null,retainedFigureAction=null}={}){
 const figure=recordFigureRenderer(inlineRecord,esc,{assetUrl,figureSources,figureActions,figureResults,figureReference,retainedFigureAction});
 const fieldView=key=>Object.hasOwn(fieldsHtml,key)?fieldsHtml[key]:recordRevisionField(key,record,esc,{assetUrl,figureSources,figureActions,figureResults,figureReference,retainedFigureAction});
 const figures=fieldView('figures'),details=['tags','contributors',...(relations?['relations']:[]),'attachments'].filter(k=>record[k]?.length||fieldsHtml[k]).map(k=>({key:k,html:fieldView(k)})).filter(v=>v.html);
 return '<article class="record-revision"><p class="scope-kicker">'+esc(typeName(record))+' &middot; '+esc(record.status)+' &middot; '+esc(recordDateLabel(record.occurredOn))+'</p>'+
  (record.outcome?'<p><strong>Outcome:</strong> '+esc(record.outcome)+'</p>':'')+'<div class="prose">'+recordRevisionField('body',record,esc,{anchors,figure})+(record.sections.length?(sectionsHtml?sectionsHtml(figure):recordRevisionField('sections',record,esc,{anchors,figure})):'' )+'</div>'+
  (fieldsHtml.attempt??attemptView(record.attempt,esc,{reference:attemptReference,window:attemptWindow}))+(fieldsHtml.results??resultStatementsView(record.results,esc,{reference:resultReference}))+(record.template?'<section><h3>Record fields</h3>'+fieldView('template')+'</section>':'')+
  (figures?'<section><h3>Figures</h3>'+figures+'</section>':'')+
  details.map(({key,html})=>'<section><h3>'+labels[key]+'</h3>'+html+'</section>').join('')+'</article>';
}
export function recordRevisionComparison(previous,current,esc,options={}){
 const changes=recordChanges(previous,current);
 return changes.length?changes.map(({key,label})=>'<section class="record-revision-change"><h3>'+label+'</h3><div class="record-revision-columns"><div><h4>Earlier version</h4>'+recordRevisionField(key,previous,esc,{...options,figureReference:options.previousFigureReference??options.figureReference})+'</div><div><h4>Current saved version</h4>'+recordRevisionField(key,current,esc,{...options,figureReference:options.currentFigureReference??null})+'</div></div></section>').join(''):'<p>No changes to the record content or settings.</p>';
}
