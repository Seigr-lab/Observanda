import {validRetainedTable,retainedTableView} from './retained-table-model.js';
import {researchId} from './research-reference.js';
import {measurementRef} from './measurement-model.js';
import {analysisTextValue} from './analysis-model.js';
import messages from './locales/en/analyses.json' with {type:'json'};
import {figureTargets} from './figure-composition.js';
import compositionMessages from './locales/en/figureComposition.json' with {type:'json'};
export const RESULT_KINDS=['conclusion','number','table','comparison','figure'];
export function validResultStatement(s,{draft=false}={}){
 if(!s)return false;const table=s.kind==='table'&&s.table!==undefined,selection=draft&&s.kind==='table'&&s.tableSelection!==undefined,keys=['basis','id','kind','limitations','source','text','title',...(s.kind==='figure'?['figureId']:[]),...(table?['table']:[]),...(selection?['tableSelection']:[])];
 if(Object.keys(s).sort().join()!==keys.sort().join()||!researchId(s.id)||(s.kind==='figure'&&!researchId(s.figureId)&&!(draft&&s.figureId===''))||!RESULT_KINDS.includes(s.kind)||!['authored','retained'].includes(s.basis)||!analysisTextValue(s.title,300,!draft)||!analysisTextValue(s.text,10000,!draft)||!analysisTextValue(s.limitations,10000,!draft))return false;
 if(selection){const v=s.tableSelection;if(!v||Object.keys(v).sort().join()!=='columns,count,includeExcluded,offset'||!Array.isArray(v.columns)||v.columns.some(c=>!Number.isSafeInteger(c)||c<0)||!Number.isSafeInteger(v.offset)||!Number.isSafeInteger(v.count)||typeof v.includeExcluded!=='boolean')return false;}
 if(table&&(!validRetainedTable(s.table)||s.basis!=='retained'))return false;
 if(s.basis==='authored')return s.source===null&&!table&&!selection;
 if(draft&&s.source===null)return !table;
 return measurementRef(s.source)&&(s.kind==='table'&&draft&&!table&&!selection?['analysis','dataset'].includes(s.source.kind):s.source.kind===(table||selection?'dataset':'analysis'));
}
export function validResults(v){return v&&Object.keys(v).sort().join()==='statements,version'&&v.version===1&&Array.isArray(v.statements)&&v.statements.length<=64&&new Set(v.statements.map(s=>s?.id)).size===v.statements.length&&v.statements.every(s=>validResultStatement(s));}
export function figureResultView(figure,results,esc){
 const targets=figureTargets([figure]),ids=new Set(targets.map(f=>f.id)),statements=results?.statements.filter(s=>s.kind==='figure'&&ids.has(s.figureId))??[];
 if(!statements.length)return '<p>'+esc(messages.figureUnlinked)+'</p>';
 const links='<p>'+statements.map(s=>'<a href="#result-'+esc(s.id)+'">'+esc(s.title)+' · '+esc(messages[s.basis])+(s.figureId!==figure.id?' · '+esc(targets.find(f=>f.id===s.figureId).title):'')+'</a>').join(' · ')+'</p>';
 const missing=figure.kind==='panels'&&!statements.some(s=>s.figureId===figure.id)?figure.panels.filter(p=>!statements.some(s=>s.figureId===p.figure.id)):[];
 return links+missing.map(p=>'<p>'+esc(compositionMessages.missingPanelResult.replace('{panel}',()=>p.label))+'</p>').join('');
}
export const resultReferences=v=>(v?.statements??[]).flatMap(s=>s.source?[s.source]:[]);
export function resultStatementsView(value,esc,{message=k=>messages[k],reference=null,edit=null}={}){
 if(!value?.statements.length)return '';return '<section class="result-statements"><h2>'+esc(message('results'))+'</h2>'+value.statements.map(s=>'<section id="result-'+esc(s.id)+'"><h3>'+esc(s.title)+'</h3><p>'+esc(message(s.kind))+' · '+esc(message(s.basis))+'</p><div class="result-statement-text">'+esc(s.text)+'</div>'+(s.table?retainedTableView(s.table,esc):'')+'<p>'+esc(s.limitations)+'</p>'+(s.source?(reference?reference(s.source):'<p>'+esc(message('sourcePrivate'))+'</p>'):'')+(edit?edit(s):'')+'</section>').join('')+'</section>';
}
export function projectResults(value){if(!value)return undefined;return {...value,statements:value.statements.map(s=>({...s,source:s.source?{withheld:true}:null,...(s.table?{table:{...s.table,rows:s.table.rows.map(r=>({...r,cells:r.cells.map((v,i)=>r.presence[i]==='value'?v:'')})),selection:{includeExcluded:s.table.selection.includeExcluded}}}:{})}))};}
