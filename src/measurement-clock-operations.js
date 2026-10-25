import {unionAlignmentDecisions} from './coordinate-alignment.js';
import {validCoordinateAlignmentColumn,validCoordinateAlignmentCell} from './web/coordinate-alignment-model.js';
import {validatePolicyScalar} from './web/measurement-scalar-policy.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {graphScalarCell} from './dataset-resource-values.js';
import {AppError} from './errors.js';
import {ArithmeticBudget,ExactNumber,exactExpression} from './tools/exact-arithmetic.js';
import {exactRational} from './web/measurement-rational.js';
import {unitScalar} from './web/measurement-unit-model.js';
import {clockOperationColumn} from './web/measurement-clock-operation-model.js';
const missing={value:'',kind:'absent'},fail=()=>{throw new AppError('MEASUREMENT_CLOCK_TRANSITION');};
function operation(name,values,budget){return exactExpression({type:'FunctionNode',name,args:values.map((_,i)=>({type:'SymbolNode',name:'v'+i}))},Object.fromEntries(values.map((value,i)=>['v'+i,value])),budget);}
function scalar(value,budget){return new ExactNumber(value.numerator,value.denominator,budget);}
function integer(cell,column,budget){if(!cell||['null','absent'].includes(cell.kind)||column.missing.some(item=>item.value===cell.value))return {status:'missing'};if(cell.value?.format==='dataset-cell')throw Error('Exact clock input exceeds the calculation resource budget.');if(typeof cell.value!=='string')return {status:'invalid'};if(cell.value.length>(budget.scalarPolicy?.resources.maxScalarCharacters??8192))throw Error('Exact clock input exceeds the calculation resource budget.');let parsed;try{parsed=column.resourcePolicy?validatePolicyScalar({spelling:cell.value,representation:column.representation,radix:column.radix},column.resourcePolicy,{budget}):exactRational(cell.value,column.representation,column.radix,budget);}catch(error){if(['value','representation','digit'].includes(error.message))return {status:'invalid'};throw error;}const n=scalar(parsed,budget);return n.d!==1n||n.n<0n?{status:'invalid'}:{value:n};}
export function evaluateClockTransition(node,column,{current,previous,currentExcluded=false,previousExcluded=false,hasCurrent=true,hasPrevious=true,wraps,resets,controls=[],consume=()=>{}},budget=new ArithmeticBudget()){
 clockOperationColumn(node,column,controls,{budget});const finish=(status,value)=>{if(node.operation==='status')return {value:status,kind:'string'};if(status!=='ready'){if(node.transition.ambiguity==='error'&&!['no-predecessor','unmatched-row','excluded-current','excluded-previous','reset'].includes(status))fail();return {...missing};}return {value:node.operation==='ticks'?value.n.toString():value.n+'/'+value.d,kind:'string'};};
 if(!hasCurrent)return finish('unmatched-row');if(currentExcluded)return finish('excluded-current');if(!hasPrevious)return finish('no-predecessor');if(previousExcluded)return finish('excluded-previous');
 const readInteger=(cell,definition)=>{consume(cell,definition);return integer(cell,definition,budget);};
 const a=readInteger(current,column),b=readInteger(previous,column);if(a.status||b.status)return finish(a.status==='missing'||b.status==='missing'?'missing-counter':'invalid-counter');const definition=column.time.clock.definition,modulus=definition.modulus?scalar(unitScalar(definition.modulus,budget,definition.resourcePolicy),budget):null;
 if(modulus&&(a.value.n>=modulus.n||b.value.n>=modulus.n))return finish('invalid-counter');let at=0,wrapCount=new ExactNumber(0n,1n,budget),reset=false;
 for(const [name,cell]of [['wraps',wraps],['resets',resets]])if(node.transition[name].kind==='column'){const value=readInteger(cell,controls[at++]);if(value.status)return finish(value.status==='missing'?'missing-control':'invalid-control');if(name==='wraps')wrapCount=value.value;else{if(value.value.n>1n)return finish('invalid-control');reset=value.value.n===1n;}}
 if(reset)return finish('reset');let delta=operation('subtract',[a.value,b.value],budget);if(wrapCount.n)delta=operation('add',[delta,operation('multiply',[wrapCount,modulus],budget)],budget);if(delta.n<0n)return finish('ambiguous-decrease');
 if(node.operation==='interval'){const rate=definition.rate;delta=operation('divide',[operation('multiply',[delta,scalar(unitScalar(rate.interval,budget,definition.resourcePolicy),budget)],budget),scalar(unitScalar(rate.counts,budget,definition.resourcePolicy),budget)],budget);}return finish('ready',delta);
}
export async function adjacentCounterLocation(materials,binding,location,{signal}={}){
 if(!location)return null;if(binding.source.kind!=='dataset'||location.kind!=='dataset')fail();const doc=await materials.read(binding.source),data=await materials.retainedDatasetPage(doc,location.page,{metadataOnly:true}),current=data.rows[location.row];if(!current||current.id!==location.id||(current.excluded??null)!==(location.excluded??null))fail();signal?.throwIfAborted();let page=location.page,row=location.row-1,values=data.rows;
 if(row<0){if(page===0)return null;page--;values=(await materials.retainedDatasetPage(doc,page,{metadataOnly:true})).rows;row=values.length-1;}const prior=values[row];if(!prior)fail();return {kind:'dataset',page,row,id:prior.id,excluded:prior.excluded,order:prior.order??prior.line};
}
// One selected source/column set and at most two immutable pages per evaluation.
// Re-read the pinned material on each use so authorization/visibility is not cached.
export class ClockTransitionReader{
 constructor(materials){this.materials=materials;this.key=null;this.pages=new Map();}
 async read(node,binding,location,{signal,resourcePolicy}={}){
  signal?.throwIfAborted();if(!location)return {hasCurrent:false,hasPrevious:false,current:missing,previous:missing};if(binding.source.kind!=='dataset'||location.kind!=='dataset')fail();const m=this.materials,doc=await m.read(binding.source),columns=[...new Set([node.column,...['wraps','resets'].filter(k=>node.transition[k].kind==='column').map(k=>node.transition[k].column)])],key=JSON.stringify([binding.source,columns]);if(key!==this.key){this.key=key;this.pages.clear();}
  const page=async index=>{signal?.throwIfAborted();let value=this.pages.get(index);if(!value){value=await m.retainedDatasetPage(doc,index,{columns});if(this.pages.size===2)this.pages.delete(this.pages.keys().next().value);this.pages.set(index,value);}return value;},current=(await page(location.page)).rows[location.row];if(!current||current.id!==location.id||(current.excluded??null)!==(location.excluded??null))fail();let previous=location.row>0?(await page(location.page)).rows[location.row-1]:location.page>0?(await page(location.page-1)).rows.at(-1):null;if(location.page>0&&!previous)fail();
  const cell=async(row,index)=>{if(!row)return missing;const at=columns.indexOf(index),value=row.cells[at],kind=row.valueKinds[at],coordinateAlignment=row.cellCoordinateAlignments?.[at],selected={value,kind,...(coordinateAlignment!==undefined?{coordinateAlignment}:{})};if(value?.format==='dataset-cell'){if(resourcePolicy)return graphScalarCell(m,selected,resourcePolicy,{signal});if(value.characters>8192)throw Error('Exact clock input exceeds the calculation resource budget.');const result=await m.readDatasetCell(value,{limit:8192,signal});if(result.next!==null)fail();return {...selected,value:result.text};}return selected;},result={hasCurrent:true,hasPrevious:!!previous,currentExcluded:!!current.excluded,previousExcluded:!!previous?.excluded,current:await cell(current,node.column),previous:await cell(previous,node.column)};for(const name of ['wraps','resets'])if(node.transition[name].kind==='column')result[name]=await cell(current,node.transition[name].column);signal?.throwIfAborted();return result;
 }
}
export async function graphClockCell(engine,node,binding,location,column,controls,options={}){
 options.signal?.throwIfAborted();const definitions=[column,...controls],aligned=definitions.some(value=>value.coordinateAlignment!==undefined);
 if(aligned&&!options.alignment)throw new AppError('DATASET_CALCULATION');for(const definition of definitions)if(definition.coordinateAlignment!==undefined&&!validCoordinateAlignmentColumn(definition.coordinateAlignment))throw new AppError('MATERIAL_MISSING');
 const reader=options.clockReader??new ClockTransitionReader(engine.materials),values=await reader.read(node,binding,location,options),decisions=[];
 if(!options.alignment&&['current','previous','wraps','resets'].some(name=>values[name]?.coordinateAlignment!==undefined))throw new AppError('DATASET_CALCULATION');
 // At most two counters and two controls are consumed. Early transition states
 // and controls after a failing control do not depend on their numeric cells.
 const consume=(cell,definition)=>{const marker=cell?.coordinateAlignment,declared=definition.coordinateAlignment!==undefined;if(marker!==undefined&&!declared||declared&&!validCoordinateAlignmentCell(marker))throw new AppError('MATERIAL_MISSING');if(marker)decisions.push(marker);};
 const result=numericalOperation(options.resourcePolicy?new DatasetResourceBudget(options.resourcePolicy):undefined,budget=>evaluateClockTransition(node,column,{...values,controls,consume},budget));options.signal?.throwIfAborted();
 return aligned?{...result,coordinateAlignment:await unionAlignmentDecisions(options.evaluationMaterials??engine.materials,decisions,{write:options.write,signal:options.signal})}:result;
}

export async function clockCellEquals(materials,value,expected,{signal}={}){
 if(typeof value==='string')return value===expected;let offset=0;while(true){signal?.throwIfAborted();const page=await materials.readDatasetCell(value,{offset,limit:16384,signal});if(page.total!==expected.length||page.offset!==offset||page.text!==expected.slice(offset,offset+page.text.length))return false;offset+=page.text.length;if(page.next===null)return offset===expected.length;if(!page.text.length||page.next!==offset)return false;}
}
