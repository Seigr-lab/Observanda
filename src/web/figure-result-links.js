import {figureTargets} from './figure-composition.js';
import messages from './locales/en/figureComposition.json' with {type:'json'};
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
 if(results.statements.length+additions.length>64)throw new Error(messages.resultLimit);
 return additions.length?{...results,statements:[...results.statements,...additions]}:results;
}
