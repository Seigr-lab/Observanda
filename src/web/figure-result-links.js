import {figureTargets} from './figure-composition.js';
import messages from './locales/en/figureComposition.json' with {type:'json'};
import {t} from './i18n/index.js';
import {researchId} from './research-reference.js';
import {revisionText} from './revision-model.js';

export function figureHasResults(figure,results){const ids=new Set(figureTargets([figure]).map(f=>f.id));return !!results?.statements.some(s=>s.kind==='figure'&&ids.has(s.figureId));}
// Identity and presentation changes do not turn a retained calculation into a
// new calculation. Data, coordinate meanings, summaries and ranges do.
export function sameFigureCalculation(a,b){
 const projection=f=>f.kind==='panels'?{kind:f.kind,layout:f.layout,panels:f.panels.map(p=>projection(p.figure))}:{kind:f.kind,x:f.x,y:f.y,summary:f.summary??null,heatmap:f.heatmap??null,markerArea:f.markerArea??null,series:f.series.map(s=>({name:s.name,points:s.points}))};
 return revisionText(projection(a))===revisionText(projection(b));
}
// A copied panel keeps explicit analysis references and interpretation limits.
// The caller applies this alongside the figure copy in the same record draft.
export function copyFigureResults(results,pairs,{uuid=()=>crypto.randomUUID()}={}){
 if(!results)return results;
 const additions=[];
 for(const [source,copy] of pairs){
  const from=figureTargets([source]),to=figureTargets([copy]);
  for(const statement of results.statements)if(statement.kind==='figure'){
   const i=from.findIndex(f=>f.id===statement.figureId);if(i<0)continue;
   additions.push({...structuredClone(statement),id:uuid(),figureId:to[i].id});
  }
 }
 return additions.length?{...results,statements:[...results.statements,...additions]}:results;
}

// Reading windows carry counts for the visible figure and its panels, never a
// partial list that could falsely imply the absence of a supporting statement.
export function figureResultLinks(figure,counts,esc,{action='content-results-figure'}={}){
 const targets=figureTargets([figure]),known=id=>Number.isSafeInteger(counts?.[id])&&counts[id]>=0;
 const available=targets.filter(target=>!known(target.id)||counts[target.id]>0);
 if(!available.length)return '<p>'+esc(t('analyses','figureUnlinked'))+'</p>';
 const links='<div class="inline-actions">'+available.map(target=>'<button type="button" class="text-button" data-action="'+action+'" data-result-figure="'+target.id+'">'+esc(target.title||figure.title)+' - '+esc(known(target.id)?t('recordContent','figureResults',{count:counts[target.id]}):t('recordContent','figureResultsUnknown'))+'</button>').join('')+'</div>';
 const missing=figure.kind==='panels'&&known(figure.id)&&counts[figure.id]===0?figure.panels.filter(panel=>known(panel.figure.id)&&counts[panel.figure.id]===0):[];
 return links+missing.map(panel=>'<p>'+esc(messages.missingPanelResult.replace('{panel}',()=>panel.label))+'</p>').join('');
}
export function resultStatementAnchor(value){
 const match=/^(?:record-)?result-(.+)$/.exec(value??'');return match&&researchId(match[1])?'result-'+match[1]:null;
}
