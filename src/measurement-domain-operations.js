// Domain operations retain exact components and require explicit declared capabilities.
import {AppError} from './errors.js';
import {domainCapabilities,sameDomainSpace,domainComponentIndex} from './web/measurement-domain-model.js';
import {sameUnitDefinition} from './web/measurement-unit-model.js';
import {revisionText} from './web/revision-model.js';
import {formatExactResult} from './web/measurement-format.js';
import {exactRational} from './web/measurement-rational.js';
import {domainValuesEqual,validateDomainValue,domainValuePage,domainValueKey} from './measurement-domain-storage.js';
const fail=(code='MEASUREMENT_DOMAIN_INCOMPATIBLE')=>{throw new AppError(code);};
export function assertDomainColumn(column){if(column?.representation!=='domain'||!domainCapabilities(column.domain).supported)fail('MEASUREMENT_DOMAIN_UNSUPPORTED');return column;}
function sameUnits(a,b){const x=a.quantity?.unitDefinition,y=b.quantity?.unitDefinition;return a.unit===b.unit&&(!x&&!y||!!x&&!!y&&sameUnitDefinition(x,y));}
export function assertDomainComparison(a,b,operator='eq'){assertDomainColumn(a);assertDomainColumn(b);if(!['eq','ne'].includes(operator)||!sameDomainSpace(a.domain,b.domain)||!sameUnits(a,b))fail();}
export function domainOperationColumn(node,columns){
 const a=assertDomainColumn(columns[0]);if(node.operation==='choose'){const b=assertDomainColumn(columns[1]);assertDomainComparison(a,b);if(revisionText(a.domain)!==revisionText(b.domain))fail();}
 if(node.operation==='extract'){if(!domainCapabilities(a.domain).extract)fail('MEASUREMENT_DOMAIN_UNSUPPORTED');domainComponentIndex(a.domain,node.component);const {domain,...result}=a;return {...result,representation:'rational',radix:10,missing:[],quantity:{...(a.quantity??{conversion:null,calibration:null}),origin:'derived'}};}
 return structuredClone(a);
}
const absent={value:'',kind:'absent'};
const present=(cell,column)=>!['absent','null'].includes(cell.kind)&&!column.missing.some(item=>item.value===cell.value);
export function compareDomainCells(materials,a,b,columns,operator){assertDomainComparison(columns[0],columns[1],operator);if(!present(a,columns[0])||!present(b,columns[1]))return null;validateDomainValue(materials,a.value,columns[0].domain);validateDomainValue(materials,b.value,columns[1].domain);const result=domainValuesEqual(materials,a.value,b.value);return result===null?null:operator==='eq'?result:!result;}
export async function calculateDomainNode(materials,node,cells,columns){
 domainOperationColumn(node,columns);let selected=0;if(node.operation==='choose'){const condition=cells[2];if(!condition)fail();if(['absent','null'].includes(condition.kind))selected=null;else{if(condition.kind!=='string'||!['0','1'].includes(condition.value))fail();selected=condition.value==='1'?0:1;}}if(selected===null||!present(cells[selected],columns[selected]))return absent;
 const value=validateDomainValue(materials,cells[selected].value,columns[selected].domain);if(node.operation!=='extract')return {...cells[selected]};
 const index=domainComponentIndex(columns[0].domain,node.component),page=await domainValuePage(materials,value,{offset:index,limit:1}),component=page.items[0];if(component.presence==='null')return {value:'',kind:'null'};
 const context=value.definition.component;return {value:formatExactResult(exactRational(component.spelling,context.representation,context.radix),{version:1,representation:'rational',radix:10}),kind:'string'};
}
export function domainColumnKey(materials,cell,column){assertDomainColumn(column);if(!present(cell,column))return null;return domainValueKey(materials,cell.value,column.domain);}
