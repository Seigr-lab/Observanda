import {validDomainAlgebraOperation} from './measurement-domain-algebra-model.js';
import {validWindow} from './dataset-window-model.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {INTERVAL_OPERATIONS} from './measurement-interval-model.js';
import {CLOCK_OPERATIONS,validClockTransition} from './measurement-clock-operation-model.js';
// Bounded graph edits reference immutable earlier nodes; outputs have independent order.
import {researchId} from './research-reference.js';
import {validMaterialReference} from './material-reference.js';
import {validOperand,calculationOperations,calculationUnary,CALCULATION_COMPARISONS} from './dataset-calculation-model.js';
import {validNumeralContext} from './numeral-context.js';
import {validQuantity} from './measurement-model.js';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>names.includes(key));
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
export const CALCULATION_GRAPH_TOOL='Observanda calculation graph';
export const CALCULATION_GRAPH_COLLECTIONS=['bindings','nodes','outputs'];
export const graphPosition=value=>Number.isSafeInteger(value)&&value>=0;
export const validGraphAddress=value=>keys(value,['id','position'])&&researchId(value.id)&&graphPosition(value.position);
export const validGraphCalculation=value=>keys(value,['version','graph'])&&[4,5,6,7,8,9,10,11,12,13,14].includes(value.version)&&validMaterialReference(value.graph)&&value.graph.kind==='analysis';
export function validGraphBinding(value,{keysIndex}={}){
 return keys(value,['id','source','view','match'])&&researchId(value.id)&&validMaterialReference(value.source)&&['dataset','analysis'].includes(value.source.kind)&&['observations','distribution','transitions'].includes(value.view)&&(value.match===null||keys(value.match,['keysIndex','unmatched'])&&value.source.kind==='dataset'&&['error','keep'].includes(value.match.unmatched)&&!!keysIndex?.(value.match.keysIndex));
}
export const validGraphJoinKey=(value,version=1)=>keys(value,['left','right','semantics'])&&validGraphAddress(value.left)&&graphPosition(value.right)&&(version>=2?['lexical','numeric','domain']:['lexical','numeric']).includes(value.semantics);
export function validGraphNode(value,position=Infinity,version=1,policy){
 if(!value||!researchId(value.id))return false;const earlier=ref=>validGraphAddress(ref)&&ref.position<position;
 if(value.kind==='column')return keys(value,['id','kind','binding','column'])&&validGraphAddress(value.binding)&&graphPosition(value.column);
 if(value.kind==='window')return version>=6&&keys(value,['id','kind','binding','column','operation','window'])&&validGraphAddress(value.binding)&&graphPosition(value.column)&&validWindow(value.window,value.operation);
 if(value.kind==='clock-synchronize')return version>=9&&keys(value,['id','kind','binding','column','model','operation','outside'])&&validGraphAddress(value.binding)&&graphPosition(value.column)&&validMaterialReference(value.model)&&value.model.kind==='analysis'&&['value','status'].includes(value.operation)&&['absent','error'].includes(value.outside);
 if(value.kind==='clock')return version>=3&&keys(value,['id','kind','binding','column','operation','transition'])&&validGraphAddress(value.binding)&&graphPosition(value.column)&&CLOCK_OPERATIONS.includes(value.operation)&&validClockTransition(value.transition);
 if(value.kind==='interval')return version>=4&&keys(value,['id','kind','operation','left','right','unit','quantity'])&&INTERVAL_OPERATIONS.includes(value.operation)&&earlier(value.left)&&(['lower','upper'].includes(value.operation)?value.right===null&&value.unit===undefined&&value.quantity===undefined:earlier(value.right)&&text(value.unit,100)&&validQuantity(value.quantity,value.unit));
 if(value.kind==='constant')return keys(value,['id','kind','value'])&&Object.hasOwn(value.value??{},'constant')&&(version>=5?validPolicyGraphConstant(value.value,policy):validOperand(value.value,0,3));
 if(value.kind==='domain-permute')return version>=11&&keys(value,['id','kind','left','axes'])&&earlier(value.left)&&Array.isArray(value.axes)&&value.axes.length>=1&&value.axes.length<=16&&new Set(value.axes).size===value.axes.length&&Array.from(value.axes).every(axis=>Number.isSafeInteger(axis)&&axis>=0&&axis<value.axes.length);
 if(value.kind==='domain-reshape')return version>=10&&keys(value,['id','kind','left','shape'])&&earlier(value.left)&&Array.isArray(value.shape)&&value.shape.length>=1&&value.shape.length<=16&&value.shape.every(length=>Number.isSafeInteger(length)&&length>0)&&Number.isSafeInteger(value.shape.reduce((count,length)=>count*length,1));
 if(value.kind==='domain-arithmetic')return version>=8&&keys(value,['id','kind','operation','left','right'])&&validDomainAlgebraOperation(value.operation)&&earlier(value.left)&&earlier(value.right);
 if(value.kind==='domain')return version>=2&&keys(value,['id','kind','operation','left','right','condition','component'])&&['copy','choose','extract'].includes(value.operation)&&earlier(value.left)&&(value.operation==='choose'?earlier(value.right)&&earlier(value.condition):value.right===null&&value.condition===null)&&(value.operation==='extract'?Array.isArray(value.component)&&value.component.length>0&&value.component.length<=16&&value.component.every(graphPosition):value.component===null);
 if(value.kind==='comparison')return keys(value,['id','kind','left','right','operator'])&&earlier(value.left)&&earlier(value.right)&&CALCULATION_COMPARISONS.includes(value.operator);
 if(value.kind==='boolean')return keys(value,['id','kind','left','right','operator'])&&earlier(value.left)&&['and','or','not'].includes(value.operator)&&(value.operator==='not'?value.right===null:earlier(value.right));
 return value.kind==='scalar'&&keys(value,['id','kind','operation','left','right','condition','unit','quantity','output'])&&calculationOperations(3).includes(value.operation)&&earlier(value.left)&&(calculationUnary(value.operation)?value.right===null:earlier(value.right))&&(value.operation==='choose'?earlier(value.condition):value.condition===null)&&text(value.unit,100)&&(value.quantity===undefined||validQuantity(value.quantity,value.unit))&&(value.output===undefined||validNumeralContext(value.output));
}
export const validGraphOutput=value=>keys(value,['id','name','node'])&&researchId(value.id)&&text(value.name,200)&&!!value.name.trim()&&validGraphAddress(value.node);
export function* graphNodeInputs(node){if(node.left)yield node.left;if(node.right)yield node.right;if(node.condition)yield node.condition;}
export const graphAddress=(value,position)=>({id:value.id,position});

export function validPolicyGraphConstant(value,policy){
 if(!validDatasetResourcePolicy(policy)||!keys(value,['constant','unit','representation','radix','quantity'])||!text(value.unit,100)||value.quantity!==undefined&&!validQuantity(value.quantity,value.unit))return false;
 if(value.representation===undefined||value.representation==='text')return validOperand(value,0,3);
 if(!validNumeralContext({version:1,representation:value.representation,radix:value.radix})||!text(value.constant,policy.resources.maxScalarCharacters))return false;
 const source=value.constant.replace(/^[+-]/,'');if(value.representation==='rational')return /^\d+\/[1-9]\d*$/.test(source);if(value.representation==='decimal')return /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(source);
 if(!/^(?:[0-9a-z]+\.?[0-9a-z]*|\.[0-9a-z]+)$/i.test(source)||['integer','radix'].includes(value.representation)&&source.includes('.'))return false;return [...source.toLowerCase().replace('.','')].every(c=>parseInt(c,36)<value.radix);
}
