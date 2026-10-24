import {sequenceText} from './measurement-sequence-ui.js';
import {SEQUENCE_OPERATIONS,validSequenceOperation} from './measurement-sequence-model.js';
import {validGraphAddress} from './dataset-calculation-graph-model.js';
const displayPosition=value=>Number.isSafeInteger(value)&&value>=0?(BigInt(value)+1n).toString():'1';
export function sequenceGraphControls(node,{esc,field,address}){
 const operation=node.operation??{kind:'length'},input=(key,label,value)=>field(esc(sequenceText(label)),'<input data-graph-field="'+key+'" inputmode="numeric" value="'+esc(value)+'">');
 return '<p>'+esc(sequenceText('graphHelp'))+'</p>'+field(esc(sequenceText('operation')),'<select data-graph-field="operation">'+SEQUENCE_OPERATIONS.map(kind=>'<option value="'+kind+'"'+(kind===operation.kind?' selected':'')+'>'+esc(sequenceText('op-'+kind))+'</option>').join('')+'</select>')+address('left',sequenceText('left'),node.left)+'<div data-sequence-operation-fields="concatenate">'+address('right',sequenceText('right'),node.right)+'<p>'+esc(sequenceText('concatenateHelp'))+'</p></div><div data-sequence-operation-fields="index">'+input('index','index',displayPosition(operation.index))+'</div><div data-sequence-operation-fields="slice">'+input('start','start',displayPosition(operation.start))+input('count','count',operation.count??0)+'</div><p>'+esc(sequenceText('rangeHelp'))+'</p>';
}
export function wireSequenceGraphControls(root){const controller=new AbortController(),operation=root.querySelector('[data-graph-field="operation"]'),refresh=()=>{for(const area of root.querySelectorAll('[data-sequence-operation-fields]')){area.hidden=area.dataset.sequenceOperationFields!==operation.value;for(const control of area.querySelectorAll('input,button'))control.disabled=area.hidden;}};operation.addEventListener('change',refresh,{signal:controller.signal});refresh();return ()=>controller.abort();}
export function readSequenceGraph(root,node,position){
 const get=key=>root.querySelector('[data-graph-field="'+key+'"]').value,kind=get('operation'),address=key=>{try{return JSON.parse(get(key));}catch{return null;}},left=address('left'),right=kind==='concatenate'?address('right'):null;
 if(!validGraphAddress(left)||left.position>=position||kind==='concatenate'&&(!validGraphAddress(right)||right.position>=position))throw Error(sequenceText('operandInvalid'));
 const integer=(key,oneBased)=>{const text=get(key).trim();if(!(oneBased?/^[1-9][0-9]*$/:/^(?:0|[1-9][0-9]*)$/).test(text)||text.length>17)throw Error(sequenceText('rangeInvalid'));const value=BigInt(text)-(oneBased?1n:0n);if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw Error(sequenceText('rangeInvalid'));return Number(value);};
 const operation={kind,...(kind==='index'?{index:integer('index',true)}:kind==='slice'?{start:integer('start',true),count:integer('count',false)}:{})};if(!validSequenceOperation(operation))throw Error(sequenceText('rangeInvalid'));return {id:node.id,kind:'domain-sequence',left,right,operation};
}
