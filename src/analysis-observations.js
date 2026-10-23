import {comparisonColumns,comparisonRow,comparisonBudget,comparisonOperation} from './analysis-scalar-policy.js';
import {assertDatasetScalars} from './dataset-selected-columns.js';
import {datasetColumnPosition,datasetCell} from './web/dataset-column-selection.js';
import {AppError} from './errors.js';
import {ANALYSIS_CATEGORIES,ANALYSIS_MEMBERSHIPS,ANALYSIS_WINDOWS,analysisRational,sameAnalysisUnitDeclaration,analysisExactFields,rationalCompare,rationalDifference} from './web/analysis-model.js';
const fail=()=>{throw new AppError('ANALYSIS_MAPPING');};
// One source page at a time. Display and calculation share this interpretation;
// the original dataset, spellings, exclusions and acceptance bands never change.
export const analysisSelectedColumns=s=>[...new Set(Object.values(s.columns).filter(i=>i!==null))];
export function analysisObservation(row,columns,s,source,page,index,budget){
 assertDatasetScalars(row);
 const col=k=>s.columns[k],at=i=>datasetColumnPosition(row,i),raw=k=>col(k)===null?'':datasetCell(row,col(k)),present=i=>!['null','absent'].includes(row.valueKinds?.[at(i)])&&!columns[at(i)].missing.some(m=>m.value===datasetCell(row,i));
 const valueColumn=columns[at(col('value'))],available=present(col('value')),rational=available?analysisRational(raw('value'),valueColumn,budget):null;
 let category=col('status')===null?'unresolved':Object.keys(s.statuses).find(k=>s.statuses[k]===raw('status'));
 if(!category)fail();const exclusion=row.excluded||raw('exclusion');
 if(category==='excluded'&&!exclusion)fail();if(exclusion)category='excluded';else if(!available)category='unavailable';
 const declared=key=>col(key)===null?s[key]:raw(key),membership=declared('membership'),windowRelation=declared('windowRelation'),evidence=declared('evidence');
 if(!ANALYSIS_MEMBERSHIPS.includes(membership)||!ANALYSIS_WINDOWS.includes(windowRelation)||!['raw','aggregate'].includes(evidence))fail();
 const bounds={lower:null,upper:null};let boundary='unknown',margin=null;
 for(const side of ['lower','upper'])if(col(side)!==null&&present(col(side))){const c=columns[at(col(side))];if(c.unit!==valueColumn.unit||budget&&!sameAnalysisUnitDeclaration(c,valueColumn,budget))fail();bounds[side]=analysisRational(raw(side),c,budget);if(!bounds[side])fail();}
 if(bounds.lower&&bounds.upper&&rationalCompare(bounds.lower,bounds.upper,budget)>0)fail();
 if(rational&&(bounds.lower||bounds.upper)){
  const low=bounds.lower&&rationalCompare(rational,bounds.lower,budget),high=bounds.upper&&rationalCompare(rational,bounds.upper,budget);
  boundary=bounds.lower&&low<0?'below':bounds.upper&&high>0?'above':low===0||high===0?'on-boundary':'inside';
  const distances=[bounds.lower&&rationalDifference(rational,bounds.lower,budget),bounds.upper&&rationalDifference(bounds.upper,rational,budget)].filter(Boolean);
  margin=distances.reduce((a,b)=>rationalCompare({numerator:BigInt(a.numerator),denominator:BigInt(a.denominator)},{numerator:BigInt(b.numerator),denominator:BigInt(b.denominator)},budget)<=0?a:b);
 }
 budget?.step();
 return {source,page,row:index,id:row.id,order:row.order,category,exclusion:exclusion??'',value:raw('value'),available,unit:valueColumn.unit,representation:valueColumn.representation,radix:valueColumn.radix,exact:analysisExactFields(rational,budget),
  run:s.run,investigation:s.investigation,calibration:s.calibration,condition:declared('condition'),operation:declared('operation'),profile:declared('profile'),membership,window:declared('window'),windowRelation,evidence,
  boundary,margin,lower:raw('lower'),upper:raw('upper'),sequence:raw('sequence'),before:raw('before'),after:raw('after'),concurrent:raw('concurrent'),denominator:raw('denominator'),locator:{ref:s.dataset,selector:{kind:'cell',page,row:index,column:col('value')}}};
}
export async function* analysisObservations(materials,comparison,{signal,start=null}={}){
 for(const [source,s] of comparison.sources.entries()){
  if(start&&source<start.source)continue;
  const resume=start&&source===start.source?start:null,doc=await materials.read(s.dataset),selection=await comparisonColumns(materials,doc,analysisSelectedColumns(s),comparison,{signal}),columns=selection.columns;let count=resume?.count??0;
  if(resume&&resume.page>=materials.datasetPageCount(doc))throw new AppError('MATERIAL_MISSING');
  for(let page=resume?.page??0;page<materials.datasetPageCount(doc);page++){
   signal?.throwIfAborted();const data=await materials.retainedDatasetPage(doc,page,{columns:selection.indices});
   if(resume&&page===resume.page&&resume.row>=data.rows.length)throw new AppError('MATERIAL_MISSING');
   for(const [index,row] of data.rows.entries()){if(resume&&page===resume.page&&index<=resume.row)continue;signal?.throwIfAborted();count++;const budget=comparisonBudget(comparison),selected=await comparisonRow(materials,doc,row,columns,comparison,{signal,budget});yield comparisonOperation(budget,()=>analysisObservation(selected.row,selected.columns,s,source,page,index,budget));}
  }
  if(count!==doc.content.rowCount)throw new AppError('MATERIAL_MISSING');
 }
}
