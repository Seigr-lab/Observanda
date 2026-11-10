import {exactRational,isScalarRepresentation} from './measurement-model.js';
import {compareKey} from './query-order.js';
import {validatePolicyScalar} from './measurement-scalar-policy.js';

const index=n=>Number.isSafeInteger(n)&&n>=0;
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
export const datasetValueTests=['equal','different','contains','less','at-most','greater','at-least'];
export const datasetPresenceTests=['present','missing','null','absent','empty'];
export const emptyTableQuery=()=>({version:1,id:'',inclusion:'all',join:'all',filters:[],sort:null});
export function validTableQuery(query){
 if(!exact(query,['version','id','inclusion','join','filters','sort'])||query.version!==1||typeof query.id!=='string'||query.id.length>2048||!['all','included','excluded'].includes(query.inclusion)||!['all','any'].includes(query.join)||!Array.isArray(query.filters)||query.filters.length>16)return false;
 if(query.sort!==null&&(!exact(query.sort,['column','direction'])||!index(query.sort.column)||!['ascending','descending'].includes(query.sort.direction)))return false;
 return query.filters.every(f=>index(f?.column)&&(datasetPresenceTests.includes(f.test)?exact(f,['column','test']):exact(f,['column','test','value'])&&datasetValueTests.includes(f.test)&&typeof f.value==='string'&&f.value.length<=8192));
}

// Store the numerator and denominator as strings so a saved query result can
// cross an encrypted scratch-file boundary without a binary64 conversion.
export function tableNumber(text,column,{operand=false}={}){
 const representation=operand&&text.includes('/')?'rational':operand&&column.representation==='rational'?'decimal':column.representation;
 const rational=column.resourcePolicy?validatePolicyScalar({spelling:text,representation,radix:column.radix},column.resourcePolicy):exactRational(text,representation,column.radix);
 return [rational.numerator.toString(),rational.denominator.toString()];
}
export function tableComparison(a,b){
 if(a.kind!==b.kind)return compareKey(a.kind,b.kind);
 if(a.kind==='number'){
  const left=BigInt(a.value[0])*BigInt(b.value[1]),right=BigInt(b.value[0])*BigInt(a.value[1]);
  return compareKey(left,right);
 }
 return compareKey(a.value,b.value);
}
const missingTypes=new Set(['absent','missing','null']);
export const sortTableRows=direction=>(a,b)=>{
 if(!direction)return a.ordinal-b.ordinal;
 const aMissing=missingTypes.has(a.key.kind),bMissing=missingTypes.has(b.key.kind);
 if(aMissing!==bMissing)return aMissing?1:-1;
 return (direction==='descending'?-1:1)*tableComparison(a.key,b.key)||a.ordinal-b.ordinal;
};
export function filterOperand(filter,column){
 if(datasetPresenceTests.includes(filter.test))return null;
 if(isScalarRepresentation(column)&&filter.test!=='contains')return {kind:'number',value:tableNumber(filter.value,column,{operand:true})};
 return {kind:'text',value:filter.value};
}
export function matchesTableCell(test,key,operand){
 if(test==='missing')return missingTypes.has(key.kind);
 if(test==='present')return !missingTypes.has(key.kind);
 if(test==='absent'||test==='null')return key.kind===test;
 if(test==='empty')return key.empty===true;
 if(missingTypes.has(key.kind)||key.kind!==operand.kind)return false;
 if(test==='contains')return key.value.includes(operand.value);
 return matchesTableOrder(test,tableComparison(key,operand));
}
export function matchesTableOrder(test,order){
 return ({equal:order===0,different:order!==0,less:order<0,'at-most':order<=0,greater:order>0,'at-least':order>=0})[test];
}
