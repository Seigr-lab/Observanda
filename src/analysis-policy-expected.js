import {AppError} from './errors.js';
import {comparisonColumns,comparisonRow,comparisonBudget,comparisonOperation} from './analysis-scalar-policy.js';
import {analysisObservation,analysisSelectedColumns} from './analysis-observations.js';
import {datasetCell,datasetColumnPosition} from './web/dataset-column-selection.js';
import {analysisRational,rationalCompare,sameAnalysisUnitDeclaration} from './web/analysis-model.js';
// Ordered fixture matching is unchanged: keys remain declared lexical keys.
// Only scalar interpretation is versioned; no owner policy may become a match.
export async function verifyPolicyExpected(inputs,comparison,{signal}={}){
 const e=comparison.expected,s=comparison.sources[e.source],actualDoc=await inputs.read(s.dataset),expectedDoc=await inputs.read(e.dataset);
 const actual=await comparisonColumns(inputs,actualDoc,[...new Set([...analysisSelectedColumns(s),e.actualKey])],comparison,{signal}),expected=await comparisonColumns(inputs,expectedDoc,[...new Set([e.key,e.value])],comparison,{signal});
 const ai=inputs.iterateDataset(s.dataset,{columns:actual.indices})[Symbol.asyncIterator](),ei=inputs.iterateDataset(e.dataset,{columns:expected.indices})[Symbol.asyncIterator]();
 const out={algorithm:'ordered-exact-fixture-comparison',version:'2',correct:0,mismatched:0,unavailable:0,excluded:0,unmatched:0,rows:0,examples:[],expected:e.dataset,rationale:e.rationale};
 const available=(r,i,c)=>!['null','absent'].includes(r.valueKinds?.[datasetColumnPosition(r,i)])&&!c.missing.some(m=>m.value===datasetCell(r,i));
 try{for(;;){
  signal?.throwIfAborted();const [a,b]=await Promise.all([ai.next(),ei.next()]);if(a.done&&b.done)break;
  const budget=comparisonBudget(comparison),ar=a.done?null:await comparisonRow(inputs,actualDoc,a.value,actual.columns,comparison,{signal,budget}),br=b.done?null:await comparisonRow(inputs,expectedDoc,b.value,expected.columns,comparison,{signal,budget});out.rows++;
  const state=comparisonOperation(budget,()=>{
   if(!ar||!br||datasetCell(ar.row,e.actualKey)!==datasetCell(br.row,e.key))return 'unmatched';
   if(analysisObservation(ar.row,ar.columns,s,e.source,0,0,budget).category==='excluded'||br.row.excluded)return 'excluded';
   const av=ar.columns[actual.indices.indexOf(s.columns.value)],ev=br.columns[expected.indices.indexOf(e.value)];
   if(!available(ar.row,s.columns.value,av)||!available(br.row,e.value,ev))return 'unavailable';
   if(!sameAnalysisUnitDeclaration(av,ev,budget))throw new AppError('ANALYSIS_MAPPING');
   const x=datasetCell(ar.row,s.columns.value),y=datasetCell(br.row,e.value),a=analysisRational(x,av,budget),b=analysisRational(y,ev,budget);
   return av.unit===ev.unit&&(a&&b?rationalCompare(a,b,budget)===0:!a&&!b&&x===y)?'correct':'mismatched';
  });
  out[state]++;if(state!=='correct'&&out.examples.length<20)out.examples.push({order:out.rows,state,actual:a.done?null:a.value.id,expected:b.done?null:b.value.id});
 }}finally{await ai.return?.();await ei.return?.();}return out;
}
