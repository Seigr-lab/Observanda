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
export async function calculateWindow(node,column,reader,policy,{signal}={}){
 windowColumn(node,column);const budget=new DatasetResourceBudget(policy);let aggregate=null,selected=null,count=0,propagated=null;
 if(reader.anchor===null)return absent();
 for(let index=0;index<reader.total;index++){
  signal?.throwIfAborted();numericalOperation(budget,b=>b.step());const cell=await reader.at(index),disposition=windowDisposition(cell,column,node.window);
  if(disposition.policy==='error')fail();if(!disposition.used){if(disposition.policy==='propagate'&&!propagated)propagated=['lag','lead','min','max'].includes(node.operation)&&!cell.boundary&&!cell.excluded?{value:cell.value,kind:cell.kind}:absent();continue;}
  count++;if(['lag','lead'].includes(node.operation)){selected={value:cell.value,kind:cell.kind};continue;}if(node.operation==='count')continue;
  const input=await graphScalarCell(reader.materials??{},cell,policy,{signal});numericalOperation(budget,b=>{let parsed;try{parsed=exactRational(input.value,column.representation,column.radix,b);}catch(error){if(error.code)throw error;fail();}const number=new ExactNumber(parsed.numerator,parsed.denominator,b);if(['min','max'].includes(node.operation)){const comparison=aggregate?expression('subtract',number,aggregate,b):null;if(!aggregate||node.operation==='min'&&comparison.n<0n||node.operation==='max'&&comparison.n>0n){aggregate=number;selected={value:cell.value,kind:cell.kind};}}else aggregate=aggregate?expression('add',aggregate,number,b):number;});
 }
 if(propagated)return propagated;if(node.operation==='count')return {value:String(count),kind:'string'};if(['lag','lead','min','max'].includes(node.operation))return selected??absent();if(!count)return absent();return numericalOperation(budget,b=>{if(node.operation==='mean')aggregate=expression('divide',aggregate,new ExactNumber(BigInt(count),1n,b),b);return {value:formatExactResult({numerator:aggregate.n,denominator:aggregate.d},{version:1,representation:'rational',radix:10},b),kind:'string'};});
}
export async function graphWindowCell(materials,node,binding,location,column,policy,{windowReader,signal}={}){const reader=await (windowReader??new DatasetWindowReader(materials)).open(node,binding,location,{signal});reader.materials=materials;return calculateWindow(node,column,reader,policy,{signal});}
