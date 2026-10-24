import {readDomainShape} from './measurement-domain-ui.js';
import {t} from './i18n/index.js';
import {DOMAIN_ALGEBRA_OPERATIONS} from './measurement-domain-algebra-model.js';
import {validGraphAddress} from './dataset-calculation-graph-model.js';
export const domainAlgebraText=(key,values)=>t('datasetCalculations',key,values);
export function domainAlgebraControls(node,{esc,field,address}){
 const text=domainAlgebraText;
 return '<p>'+esc(text('algebraHelp'))+'</p>'+field(esc(text('algebraOperation')),'<select data-graph-field="operation">'+DOMAIN_ALGEBRA_OPERATIONS.map(operation=>'<option value="'+operation+'"'+(operation===node.operation?' selected':'')+'>'+esc(text('algebra-'+operation))+'</option>').join('')+'</select>')+address('left',text('algebraLeft'),node.left)+address('right',text('algebraRight'),node.right)+'<p>'+esc(text('algebraShapes'))+'</p><p>'+esc(text('algebraUnits'))+'</p>';
}
export function readDomainAlgebra(root,node,position){
 const read=key=>{try{return JSON.parse(root.querySelector('[data-graph-field="'+key+'"]').value);}catch{return null;}},operation=root.querySelector('[data-graph-field="operation"]').value,left=read('left'),right=read('right');
 if(!DOMAIN_ALGEBRA_OPERATIONS.includes(operation)||![left,right].every(value=>validGraphAddress(value)&&value.position<position))throw Error(domainAlgebraText('algebraOperands'));
 return {id:node.id,kind:'domain-arithmetic',operation,left,right};
}

export function domainReshapeControls(node,{esc,field,address}){
 const shape=node.shape??[1],kind=shape.length===1?'vector':shape.length===2?'matrix':'tensor';
 return '<p>'+esc(domainAlgebraText('reshapeHelp'))+'</p>'+address('left',domainAlgebraText('reshapeSource'),node.left)+field(esc(domainAlgebraText('reshapeKind')),'<select data-graph-field="reshape-kind">'+['vector','matrix','tensor'].map(value=>'<option value="'+value+'"'+(value===kind?' selected':'')+'>'+esc(value)+'</option>').join('')+'</select>')+field(esc(domainAlgebraText('reshapeShape')),'<input data-graph-field="shape" value="'+esc(shape.join(', '))+'">')+'<p>'+esc(domainAlgebraText('reshapeOrder'))+'</p>';
}
export function readDomainReshape(root,node,position){
 let left;try{left=JSON.parse(root.querySelector('[data-graph-field="left"]').value);}catch{}
 if(!validGraphAddress(left)||left.position>=position)throw Error(domainAlgebraText('reshapeOperand'));
 const kind=root.querySelector('[data-graph-field="reshape-kind"]').value;if(!['vector','matrix','tensor'].includes(kind))throw Error(domainAlgebraText('reshapeShapeInvalid'));
 let shape;try{shape=readDomainShape(root.querySelector('[data-graph-field="shape"]').value,{minRank:kind==='tensor'?3:kind==='matrix'?2:1,maxRank:kind==='tensor'?16:kind==='matrix'?2:1});}catch{throw Error(domainAlgebraText('reshapeShapeInvalid'));}
 return {id:node.id,kind:'domain-reshape',left,shape};
}

export function domainPermutationControls(node,{esc,field,address}){
 return '<p>'+esc(domainAlgebraText('permuteHelp'))+'</p>'+address('left',domainAlgebraText('permuteSource'),node.left)+field(esc(domainAlgebraText('permuteAxes')),'<input data-graph-field="axes" maxlength="100" aria-describedby="graph-permutation-order" value="'+esc((node.axes??[]).map(axis=>axis+1).join(', '))+'">')+'<p id="graph-permutation-order">'+esc(domainAlgebraText('permuteOrder'))+'</p>';
}
export function readDomainPermutation(root,node,position){
 let left;try{left=JSON.parse(root.querySelector('[data-graph-field="left"]').value);}catch{}
 if(!validGraphAddress(left)||left.position>=position)throw Error(domainAlgebraText('permuteOperand'));
 const entries=root.querySelector('[data-graph-field="axes"]').value.split(',').map(value=>value.trim()),axes=entries.map(value=>Number(value)-1);
 if(entries.length<1||entries.length>16||entries.some(value=>!/^[1-9][0-9]*$/.test(value))||axes.some(axis=>!Number.isSafeInteger(axis)||axis<0||axis>=axes.length)||new Set(axes).size!==axes.length)throw Error(domainAlgebraText('permuteAxesInvalid'));
 return {id:node.id,kind:'domain-permute',left,axes};
}
