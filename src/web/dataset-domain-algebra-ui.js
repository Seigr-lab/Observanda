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
