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
export const validGraphCalculation=value=>keys(value,['version','graph'])&&[4,5].includes(value.version)&&validMaterialReference(value.graph)&&value.graph.kind==='analysis';
export function validGraphBinding(value,{keysIndex}={}){
 return keys(value,['id','source','view','match'])&&researchId(value.id)&&validMaterialReference(value.source)&&['dataset','analysis'].includes(value.source.kind)&&['observations','distribution','transitions'].includes(value.view)&&(value.match===null||keys(value.match,['keysIndex','unmatched'])&&value.source.kind==='dataset'&&['error','keep'].includes(value.match.unmatched)&&!!keysIndex?.(value.match.keysIndex));
}
export const validGraphJoinKey=(value,version=1)=>keys(value,['left','right','semantics'])&&validGraphAddress(value.left)&&graphPosition(value.right)&&(version===2?['lexical','numeric','domain']:['lexical','numeric']).includes(value.semantics);
export function validGraphNode(value,position=Infinity,version=1){
 if(!value||!researchId(value.id))return false;const earlier=ref=>validGraphAddress(ref)&&ref.position<position;
 if(value.kind==='column')return keys(value,['id','kind','binding','column'])&&validGraphAddress(value.binding)&&graphPosition(value.column);
 if(value.kind==='constant')return keys(value,['id','kind','value'])&&Object.hasOwn(value.value??{},'constant')&&validOperand(value.value,0,3);
 if(value.kind==='domain')return version===2&&keys(value,['id','kind','operation','left','right','condition','component'])&&['copy','choose','extract'].includes(value.operation)&&earlier(value.left)&&(value.operation==='choose'?earlier(value.right)&&earlier(value.condition):value.right===null&&value.condition===null)&&(value.operation==='extract'?Array.isArray(value.component)&&value.component.length>0&&value.component.length<=16&&value.component.every(graphPosition):value.component===null);
 if(value.kind==='comparison')return keys(value,['id','kind','left','right','operator'])&&earlier(value.left)&&earlier(value.right)&&CALCULATION_COMPARISONS.includes(value.operator);
 if(value.kind==='boolean')return keys(value,['id','kind','left','right','operator'])&&earlier(value.left)&&['and','or','not'].includes(value.operator)&&(value.operator==='not'?value.right===null:earlier(value.right));
 return value.kind==='scalar'&&keys(value,['id','kind','operation','left','right','condition','unit','quantity','output'])&&calculationOperations(3).includes(value.operation)&&earlier(value.left)&&(calculationUnary(value.operation)?value.right===null:earlier(value.right))&&(value.operation==='choose'?earlier(value.condition):value.condition===null)&&text(value.unit,100)&&(value.quantity===undefined||validQuantity(value.quantity,value.unit))&&(value.output===undefined||validNumeralContext(value.output));
}
export const validGraphOutput=value=>keys(value,['id','name','node'])&&researchId(value.id)&&text(value.name,200)&&!!value.name.trim()&&validGraphAddress(value.node);
export function* graphNodeInputs(node){if(node.left)yield node.left;if(node.right)yield node.right;if(node.condition)yield node.condition;}
export const graphAddress=(value,position)=>({id:value.id,position});
