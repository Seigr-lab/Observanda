import {numericalOperation} from './dataset-resource-budget.js';
// Explicit interval operations reuse exact scalar/unit evaluation and retained domains.
import {AppError} from './errors.js';
import {ArithmeticBudget} from './tools/exact-arithmetic.js';
import {exactRational,isScalarRepresentation,validQuantity,blankQuantity} from './web/measurement-model.js';
import {defaultColumn} from './web/dataset-schema.js';
import {assertUnitOperation} from './web/measurement-unit-model.js';
import {intervalDomain,validIntervalDomain,validIntervalUncertainty,enclosureUncertainty} from './web/measurement-interval-model.js';
import {IntervalError,parseIntervalBounds,calculateIntervalBounds,convertIntervalBounds,intervalComponents} from './measurement-interval.js';
import {validateDomainValue,domainValuePage,retainDomainValue,domainValueSupported} from './measurement-domain-storage.js';
const fail=()=>{throw new AppError('MEASUREMENT_INTERVAL_INVALID');};
const unit=column=>column.quantity?.unitDefinition??null;
const absent={value:'',kind:'absent'};
const present=(cell,column)=>!['null','absent'].includes(cell.kind)&&!column.missing.some(item=>item.value===cell.value);
const asserted=column=>{if(column?.representation!=='domain'||!validIntervalDomain(column.domain))fail();return column;};
export function intervalOperationColumn(node,columns){
 const [left,right]=columns;if(['lower','upper'].includes(node.operation)){asserted(left);const {domain,...column}=left,{uncertainty,...quantity}=left.quantity??blankQuantity();return {...column,representation:'rational',radix:10,missing:[],quantity:{...quantity,origin:'derived'}};}
 if(!left||!right||!validQuantity(node.quantity,node.unit)||node.quantity.origin!=='derived')fail();
 if(node.operation==='bounds'){if(!isScalarRepresentation(left)||!isScalarRepresentation(right)||!validIntervalUncertainty(node.quantity.uncertainty)||node.quantity.uncertainty.kind!=='declared-interval')fail();}
 else{asserted(left);asserted(right);if(!['add','subtract','multiply','divide'].includes(node.operation))fail();if(node.quantity.uncertainty!==undefined)fail();}
 const units=[unit(left),unit(right),unit(node)];if(units.some(Boolean)){if(!units.every(Boolean))fail();try{assertUnitOperation(node.operation==='bounds'?'compare':node.operation,...units);}catch{fail();}}
 else if(['bounds','add','subtract'].includes(node.operation)&&(left.unit!==right.unit||node.unit!==left.unit))fail();
 return {...defaultColumn({label:'Interval'}),representation:'domain',domain:intervalDomain({version:1,representation:'rational',radix:10}),unit:node.unit,missing:[],quantity:{...structuredClone(node.quantity),uncertainty:node.operation==='bounds'?structuredClone(node.quantity.uncertainty):enclosureUncertainty()}};
}
async function interval(materials,cell,column,signal,budget){
 const value=validateDomainValue(materials,cell.value,column.domain);if(!domainValueSupported(value))fail();const page=await domainValuePage(materials,value,{limit:2,signal});if(page.items.length!==2||page.items.some(item=>item.presence!=='value'))fail();return numericalOperation(budget,b=>parseIntervalBounds(page.items.map(item=>item.spelling),column.domain.component,{budget:b}));
}
async function calculateIntervalNodeInner(materials,node,cells,columns,{signal,write=fn=>fn(),budget}={}){
 const output=intervalOperationColumn(node,columns);signal?.throwIfAborted();if(cells.some((cell,index)=>!present(cell,columns[index])))return absent;
 budget??=new ArithmeticBudget();const inputs=[];if(node.operation!=='bounds')for(let index=0;index<cells.length;index++)inputs.push(await interval(materials,cells[index],columns[index],signal,budget));
 if(['lower','upper'].includes(node.operation)){const value=numericalOperation(budget,budget=>intervalComponents(inputs[0],{budget}));return {value:value[node.operation==='lower'?0:1],kind:'string'};}
 const components=numericalOperation(budget,budget=>{let value;
 if(node.operation==='bounds'){const points=cells.map((cell,index)=>{if(typeof cell.value!=='string')throw new AppError('MEASUREMENT_DOMAIN_COMPONENT_LIMIT');const exact=exactRational(cell.value,columns[index].representation,columns[index].radix,budget);return {lower:exact,upper:exact};});if(unit(output))for(let index=0;index<2;index++)points[index]=convertIntervalBounds(points[index],unit(columns[index]),unit(output),{budget});value={lower:points[0].lower,upper:points[1].upper};}
 else value=calculateIntervalBounds(node.operation,inputs[0],inputs[1],{leftUnit:unit(columns[0]),rightUnit:unit(columns[1]),outputUnit:unit(output),budget});
 return intervalComponents(value,{budget});});return {kind:'string',value:await retainDomainValue(materials,{kind:'string',value:JSON.stringify(components)},output.domain,write,{signal})};
}

export async function calculateIntervalNode(...args){try{return await calculateIntervalNodeInner(...args);}catch(error){if(error instanceof IntervalError)throw new AppError(error.code);throw error;}}
