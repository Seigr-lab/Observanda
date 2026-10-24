// Resolve only known scalar fields of one admitted declaration, never a schema.
import {perCellComputation,resolveCellComputation} from './web/measurement-computation.js';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {scalarTextReference,validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {validateMeasurementDeclaration} from './web/measurement-model.js';
import {validateUnitDefinition} from './web/measurement-unit-model.js';
import {validateClockDefinition} from './web/measurement-clock-model.js';
import {validateIntervalUncertainty} from './web/measurement-interval-model.js';
import {revisionText} from './web/revision-model.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const selected=(value,path)=>path.reduce((v,key)=>v?.[key],value);
export function scalarDefinitionEntries(value){
 const result=[],add=(owner,prefix,key)=>{const scalar=selected(owner,key);if(scalar!==null&&scalar!==undefined&&owner.resourcePolicy)result.push({path:[...prefix,...key,'spelling'],scalar,policy:owner.resourcePolicy});};
 const unit=(owner,prefix)=>{if(owner?.version===2){add(owner,prefix,['scale']);add(owner,prefix,['offset']);}};
 const uncertainty=(owner,prefix)=>{if(owner?.version===2&&owner.coverage)add(owner,prefix,['coverage','level']);};
 const clock=(owner,prefix)=>{if(!owner)return;if(owner.version===2){add(owner,prefix,['modulus']);if(owner.rate){add(owner,prefix,['rate','counts']);add(owner,prefix,['rate','interval']);}}unit(owner.rate?.unitDefinition,[...prefix,'rate','unitDefinition']);};
 const synchronization=(owner,prefix)=>{if(owner?.version===1&&owner.method==='two-anchor-affine'){add(owner,prefix,['validity','lower']);add(owner,prefix,['validity','upper']);}};
 const quantity=(q,prefix)=>{unit(q?.unitDefinition,[...prefix,'unitDefinition']);uncertainty(q?.uncertainty,[...prefix,'uncertainty']);};
 if(value?.version===2&&value.value?.spelling!==undefined)add(value,[],['value']);
 if(value?.scale&&value?.offset)unit(value,[]);
 if(value?.version&&Object.hasOwn(value,'modulus'))clock(value,[]);
 if(value?.kind==='declared-interval'||value?.kind==='derived-enclosure')uncertainty(value,[]);
 synchronization(value?.synchronization,['synchronization']);synchronization(value,[]);if(value?.version===1&&value.kind==='clock-sync-segment'){add(value,[],['validity','lower']);add(value,[],['validity','upper']);}
 if(value?.tool==='Observanda coordinate frame')unit(value.unitDefinition,['unitDefinition']);
 if(value?.tool==='Observanda clock synchronization'){quantity(value.target?.quantity,['target','quantity']);clock(value.target?.time?.clock?.definition,['target','time','clock','definition']);}
 const spectrum=(owner,prefix)=>{if([1,2].includes(owner?.version)&&owner.method==='radix2-fft-v1'){add(owner,prefix,['sampling','step']);add(owner,prefix,['sampling','origin']);unit(owner.sampling?.unitDefinition,[...prefix,'sampling','unitDefinition']);}};spectrum(value,[]);spectrum(value?.spectrum,['spectrum']);
 const cusum=(owner,prefix)=>{if(owner?.version===1&&owner.method==='two-sided-tabular-cusum-v1'){for(const key of ['target','allowance','threshold'])add(owner,prefix,[key]);unit(owner.unitDefinition,[...prefix,'unitDefinition']);}};cusum(value,[]);cusum(value?.cusum,['cusum']);
 const aggregation=(owner,prefix)=>{if([4,5,6].includes(owner?.version)&&Array.isArray(owner.values))for(const [i,metric]of owner.values.entries())if(metric.operation==='quantile')add(owner,prefix,['values',i,'probability']);};
 aggregation(value,[]);aggregation(value?.aggregation,['aggregation']);
 if(value?.version===1&&value.method==='linear-n-minus-one-v1'&&value.weight)add(value,[],['weight']);
 if(Array.isArray(value?.aggregation))for(const [i,metric]of value.aggregation.entries())if(metric.quantile?.weight)result.push({path:['aggregation',i,'quantile','weight','spelling'],scalar:metric.quantile.weight,policy:value.resourcePolicy});
 if(['statistical-uncertainty-input','statistical-uncertainty-covariance'].includes(value?.kind)){const path=value.kind==='statistical-uncertainty-input'?['item','sensitivity']:['item','value'],operand=selected(value,path);if(operand?.kind==='declared'){add(value,[],[...path,'scalar']);unit(operand.unitDefinition,[...path,'unitDefinition']);}}
 if(value?.tool==='Observanda statistical uncertainty'&&value.result){for(const key of ['nominal','variance','standardUncertainty']){add(value.result,['result'],[key,'scalar']);unit(value.result[key]?.unitDefinition,['result',key,'unitDefinition']);}}
 quantity(value?.quantity,['quantity']);clock(value?.time?.clock?.definition,['time','clock','definition']);
 if(value?.kind==='constant')quantity(value.value?.quantity,['value','quantity']);
 return result;
}
export function* scalarDefinitionSequences(value){for(const entry of scalarDefinitionEntries(value))if(scalarTextReference(entry.scalar.spelling))yield entry.scalar.spelling.parts;}
export function measurementScalarPolicies(value){return !!value&&(value.resourcePolicy!==undefined||[2,3,4].includes(value.domain?.version)||scalarDefinitionEntries(value).length>0);}
function semantic(value,budget){for(const entry of scalarDefinitionEntries(value))if(entry.path.includes('probability')||entry.path.includes('weight')){const rational=validatePolicyScalar(entry.scalar,entry.policy,{budget});if(rational.numerator<0n||rational.numerator>rational.denominator)throw RangeError('Probability outside the closed unit interval');}validateMeasurementDeclaration(value,{budget});if(value?.tool==='Observanda coordinate frame')validateUnitDefinition(value.unitDefinition,{budget});if(value?.scale&&value?.offset)validateUnitDefinition(value,{budget});if(value?.version&&Object.hasOwn(value,'modulus'))validateClockDefinition(value,{budget});if(value?.kind==='declared-interval'||value?.kind==='derived-enclosure')validateIntervalUncertainty(value,{budget});if(value?.kind==='constant'&&value.value?.quantity)validateMeasurementDeclaration(value.value,{budget});}
export async function resolveScalarDefinitions(materials,value,{signal,budget}={}){
 const result=structuredClone(value),{graphScalarCell}=await import('./dataset-resource-values.js');
 for(const entry of scalarDefinitionEntries(result)){
  signal?.throwIfAborted();if(!validDatasetResourcePolicy(entry.policy))fail();const spelling=entry.scalar.spelling;
  if(typeof spelling!=='string'){if(!scalarTextReference(spelling))fail();const text=(await graphScalarCell(materials,{kind:'string',value:spelling},entry.policy,{signal})).value;if(createHash('sha256').update(Buffer.from(text,'utf16le')).digest('hex')!==spelling.sha256)fail();entry.scalar.spelling=text;}
 }
 try{semantic(result,budget);}catch(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail();}signal?.throwIfAborted();return result;
}
export async function retainScalarDefinitions(materials,value,write,{signal,base,allowRetained=false,budget}={}){
 for(const entry of scalarDefinitionEntries(value))if(typeof entry.scalar.spelling!=='string'&&!allowRetained&&revisionText(entry.scalar.spelling)!==revisionText(selected(base,entry.path)))throw new AppError('MATERIAL_INVALID');
 let result;try{result=await resolveScalarDefinitions(materials,value,{signal,budget});}catch(error){if(error.code==='MATERIAL_MISSING')throw new AppError('MATERIAL_INVALID');throw error;}const {retainDatasetCell}=await import('./dataset-cell-storage.js');
 for(const entry of scalarDefinitionEntries(result)){signal?.throwIfAborted();if(entry.scalar.spelling.length>4096)entry.scalar.spelling=(await retainDatasetCell(materials,{kind:'string',value:entry.scalar.spelling},write)).value;}
 return result;
}
export async function readScalarDefinition(materials,value,field,{offset=0,limit=4096,signal}={}){
 if(typeof field!=='string')throw new AppError('INVALID');const entry=scalarDefinitionEntries(value).find(entry=>entry.path.join('.')===field);if(!entry)throw new AppError('INVALID');
 const {readDatasetCell}=await import('./dataset-cell-storage.js');return readDatasetCell(materials,entry.scalar.spelling,{offset,limit,signal});
}

export async function resolveScalarOperand(materials,cell,column,{signal,budget,policy}={}){
 if(perCellComputation(column))resolveCellComputation(column,cell);
 if(['absent','null'].includes(cell.kind)||typeof cell.value==='string'&&column.missing?.some(item=>item.value===cell.value))return cell;
 const interpretation=column.resourcePolicy??policy;if(!interpretation)return cell;
 const {graphScalarCell}=await import('./dataset-resource-values.js'),resolved=await graphScalarCell(materials,cell,interpretation,{signal});
 if(typeof cell.value!=='string'&&createHash('sha256').update(Buffer.from(resolved.value,'utf16le')).digest('hex')!==cell.value.sha256)fail();
 if(column.resourcePolicy)validatePolicyScalar({spelling:resolved.value,representation:column.representation,radix:column.radix},column.resourcePolicy,{budget});
 return resolved;
}
