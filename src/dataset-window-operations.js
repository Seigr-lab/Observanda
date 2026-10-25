import {unionAlignmentDecisions} from './coordinate-alignment.js';
import {validCoordinateAlignmentColumn,validCoordinateAlignmentCell} from './web/coordinate-alignment-model.js';
import {perCellComputation,resolveCellComputation,effectiveCellColumn,derivedCellComputation} from './web/measurement-computation.js';
import {resolveScalarOperand} from './measurement-scalar-storage.js';
import {AppError} from './errors.js';
import {DatasetWindowReader} from './dataset-window-reader.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {graphScalarCell} from './dataset-resource-values.js';
import {ExactNumber,exactExpression} from './tools/exact-arithmetic.js';
import {exactRational} from './web/measurement-rational.js';
import {formatExactResult} from './web/measurement-format.js';
import {windowColumn,windowDisposition} from './web/dataset-window-model.js';
const absent=()=>({value:'',kind:'absent'}),fail=()=>{throw new AppError('DATASET_WINDOW_VALUE');};
const expression=(name,a,b,budget)=>exactExpression({type:'FunctionNode',name,args:[{type:'SymbolNode',name:'a'},{type:'SymbolNode',name:'b'}]},{a,b},budget);
export async function calculateWindow(node,column,reader,policy,{signal,cellComputation=false,alignment=false,write}={}){
 windowColumn(node,column);const aligned=column.coordinateAlignment!==undefined;if(aligned&&!alignment)throw new AppError('DATASET_CALCULATION');if(aligned&&!validCoordinateAlignmentColumn(column.coordinateAlignment))throw new AppError('MATERIAL_MISSING');
 const tracked=cellComputation||perCellComputation(column),exact=cell=>tracked?{...cell,computation:null}:cell;let computation={computation:null};const retain=cell=>tracked?{...cell,computation:computation.computation}:cell;const budget=new DatasetResourceBudget(policy);let aggregate=null,selected=null,count=0,propagated=null;
 const decisionOptions={write,signal},empty=aligned?await unionAlignmentDecisions(reader.materials,[],decisionOptions):null;let decisions=empty,propagatedDecisions=empty;const finish=(cell,marker=decisions)=>aligned?{...cell,coordinateAlignment:marker}:cell;
 if(reader.anchor===null)return finish(exact(absent()));
 for(let index=0;index<reader.total;index++){
  signal?.throwIfAborted();numericalOperation(budget,b=>b.step());const raw=await reader.at(index);if(raw.coordinateAlignment!==undefined&&!alignment)throw new AppError('DATASET_CALCULATION');if(raw.coordinateAlignment!==undefined&&(!aligned||raw.boundary)||aligned&&!raw.boundary&&!validCoordinateAlignmentCell(raw.coordinateAlignment))throw new AppError('MATERIAL_MISSING');
  const cell=tracked?{...raw,computation:raw.boundary?null:resolveCellComputation(column,raw)}:raw,disposition=windowDisposition(cell,column,node.window);
  if(disposition.policy==='error')fail();if(!disposition.used){if(disposition.policy==='propagate'&&!propagated){propagated=['lag','lead','min','max'].includes(node.operation)&&!cell.boundary&&!cell.excluded?{value:cell.value,kind:cell.kind,...(tracked?{computation:cell.computation}:{})}:exact(absent());propagatedDecisions=cell.coordinateAlignment??empty;}continue;}
  // Comparison candidates and reduction inputs contribute their distinct
  // decisions. Skipped rows and unselected propagated branches do not.
  if(aligned)decisions=await unionAlignmentDecisions(reader.materials,[decisions,cell.coordinateAlignment],decisionOptions);
  if(tracked)computation=derivedCellComputation(computation,cell);count++;if(['lag','lead'].includes(node.operation)){selected={value:cell.value,kind:cell.kind,...(tracked?{computation:cell.computation}:{})};continue;}if(node.operation==='count')continue;
  const input=column.resourcePolicy?await resolveScalarOperand(reader.materials??{},cell,tracked?effectiveCellColumn(column,cell):column,{signal,budget,policy}):await graphScalarCell(reader.materials??{},cell,policy,{signal});numericalOperation(budget,b=>{let parsed;try{parsed=exactRational(input.value,column.representation,column.radix,b);}catch(error){if(error.code)throw error;fail();}const number=new ExactNumber(parsed.numerator,parsed.denominator,b);if(['min','max'].includes(node.operation)){const comparison=aggregate?expression('subtract',number,aggregate,b):null;if(!aggregate||node.operation==='min'&&comparison.n<0n||node.operation==='max'&&comparison.n>0n){aggregate=number;selected={value:cell.value,kind:cell.kind,...(tracked?{computation:cell.computation}:{})};}}else aggregate=aggregate?expression('add',aggregate,number,b):number;});
 }
 if(propagated)return finish(propagated,propagatedDecisions);if(node.operation==='count')return finish(retain({value:String(count),kind:'string'}));if(['lag','lead'].includes(node.operation))return finish(selected??exact(absent()));if(['min','max'].includes(node.operation))return finish(selected?retain(selected):exact(absent()));if(!count)return finish(exact(absent()));return finish(numericalOperation(budget,b=>{if(node.operation==='mean')aggregate=expression('divide',aggregate,new ExactNumber(BigInt(count),1n,b),b);return retain({value:formatExactResult({numerator:aggregate.n,denominator:aggregate.d},{version:1,representation:'rational',radix:10},b),kind:'string'});}));
}
export async function graphWindowCell(materials,node,binding,location,column,policy,{windowReader,signal,cellComputation=false,alignment=false,write}={}){const reader=await (windowReader??new DatasetWindowReader(materials)).open(node,binding,location,{signal});reader.materials=materials;return calculateWindow(node,column,reader,policy,{signal,cellComputation,alignment,write});}
