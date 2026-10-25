import {validWeightedFitContext} from './dataset-weighted-fit-model.js';
import {validCoordinateAlignmentMeasurement,validCoordinateAlignmentAxis} from './coordinate-alignment-model.js';
import {validCusumDescriptor} from './dataset-cusum-model.js';
import {validSpectrumDescriptor} from './dataset-spectrum-model.js';
import {validStatisticalUncertaintyDescriptor} from './measurement-statistical-uncertainty-model.js';
import {validClockSynchronizationDescriptor,validateClockSynchronizationDescriptor} from './measurement-clock-synchronization-model.js';
import {validComputation,perCellComputation} from './measurement-computation.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validPolicyScalar,validatePolicyScalar} from './measurement-scalar-policy.js';
import {validIntervalUncertainty,validateIntervalUncertainty} from './measurement-interval-model.js';
// Scientific values remain strings. Arithmetic here only constructs exact rational
// identities; no unit conversion or clock unwrapping is inferred.
import {validDomainDefinition} from './measurement-domain-model.js';
import {NUMBER_REPRESENTATIONS} from './numeral-context.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {exactRational} from './measurement-rational.js';
import {validClockDefinition,validateClockDefinition} from './measurement-clock-model.js';
import {validUnitDefinition,validateUnitDefinition} from './measurement-unit-model.js';
export {exactRational} from './measurement-rational.js';
export const REPRESENTATIONS=['text','decimal','integer','radix','radix-fraction','rational','unsupported','domain'];
export const isScalarRepresentation=value=>NUMBER_REPRESENTATIONS.includes(typeof value==='string'?value:value?.representation);
export const validColumnDomain=column=>column.representation==='domain'?validDomainDefinition(column.domain):column.domain===undefined;
export const QUANTITY_ORIGINS=['unspecified','requested','measured','derived','raw-code'];
export const TIME_KINDS=['none','unknown','acquisition-order','counter','wall-clock','elapsed','powered-duration','inferred-elapsed','external'];
export const MEASUREMENT_ROLES=['decoder','schema'];
const text=(v,max=2000)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const keys=(v,list)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>list.includes(k));
export const measurementRef=r=>keys(r,['kind','id','revision','workspaceId','label'])&&['artifact','dataset','analysis','collection','record'].includes(r.kind)&&researchId(r.id)&&revisionId(r.revision)&&(r.workspaceId===undefined||researchId(r.workspaceId))&&(r.label===undefined||text(r.label,300));
const optionalRef=r=>r===null||measurementRef(r);
const uint=v=>Number.isSafeInteger(v)&&v>=0;
export function supportedValue(value,representation,radix){
 if(['text','unsupported'].includes(representation))return text(value,262144);
 try{exactRational(value,representation,radix);return true;}catch{return false;}
}
export function rationalIdentity(value){
 if(value.presence!=='value'||!isScalarRepresentation(value.representation))return null;
 const rational=exactRational(value.spelling,value.representation,value.radix);
 return {numerator:String(rational.numerator),denominator:String(rational.denominator)};
}
export const blankQuantity=()=>({origin:'unspecified',conversion:null,calibration:null});
export function validQuantity(q,unit){return keys(q,['origin','conversion','calibration','unitDefinition','uncertainty'])&&QUANTITY_ORIGINS.includes(q.origin)&&optionalRef(q.conversion)&&optionalRef(q.calibration)&&(q.unitDefinition===undefined||validUnitDefinition(q.unitDefinition))&&(q.uncertainty===undefined||validIntervalUncertainty(q.uncertainty))&&(q.origin!=='raw-code'||unit===''&&q.unitDefinition===undefined&&q.uncertainty===undefined);}
export const blankClock=()=>({width:null,frequency:'',ordering:'unknown',wrap:'unknown',reset:'unknown',epoch:'',model:null,referenceData:null});
export function validTime(time){
 if(!keys(time,['kind','reference','resolution','uncertainty','clock'])||!TIME_KINDS.includes(time.kind)||!['reference','resolution','uncertainty'].every(k=>text(time[k],500)))return false;
 if(time.clock===undefined)return time.kind!=='external';
 const c=time.clock;if(!keys(c,['width','frequency','ordering','wrap','reset','epoch','model','referenceData','definition'])||!(c.width===null||Number.isInteger(c.width)&&c.width>=1&&c.width<=4096)||!text(c.frequency,200)||!['unknown','source','monotonic','unordered'].includes(c.ordering)||!['unknown','none','modulo','observed'].includes(c.wrap)||!['unknown','none','observed'].includes(c.reset)||!text(c.epoch,500)||!optionalRef(c.model)||!optionalRef(c.referenceData))return false;
 if(c.definition!==undefined&&!validClockDefinition(c.definition))return false;
 if(c.frequency){try{if(exactRational(c.frequency).numerator<=0n)return false;}catch{return false;}}
 return time.kind!=='external'||!!c.model&&!!c.referenceData;
}
export function schemaReferences(column){return [column.quantity?.conversion,column.quantity?.calibration,column.quantity?.uncertainty?.method?.reference,column.time?.clock?.model,column.time?.clock?.referenceData,column.computation?.recipe,column.spectrum?.analysis,column.cusum?.analysis,column.statisticalUncertainty?.definition,column.statisticalUncertainty?.analysis,column.coordinateFrame?.frame,column.coordinateFrame?.sourceFrame,column.coordinateFrame?.transform,column.coordinateAxis?.frame].filter(Boolean);}
export function validLocator(source){
 if(!keys(source,['ref','selector'])||!measurementRef(source.ref))return false;const s=source.selector;
 if(!s)return false;
 if(source.ref.kind==='dataset')return keys(s,['kind','page','row','column'])&&s.kind==='cell'&&uint(s.page)&&uint(s.row)&&s.row<256&&uint(s.column);
 if(source.ref.kind!=='artifact')return keys(s,['kind'])&&s.kind==='whole';
 if(s.kind==='whole')return keys(s,['kind']);
 if(s.kind==='bytes')return keys(s,['kind','offset','length','nativeId'])&&uint(s.offset)&&uint(s.length)&&s.length>0&&uint(s.offset+s.length)&&(s.nativeId===undefined||text(s.nativeId,500));
 if(s.kind==='json-pointer')return keys(s,['kind','pointer'])&&text(s.pointer,2048)&&(s.pointer===''||s.pointer.startsWith('/'))&&!/~(?![01])/u.test(s.pointer);
 return keys(s,['kind','nativeId'])&&s.kind==='native-record'&&text(s.nativeId,500)&&!!s.nativeId.trim();
}
export function validMeasurement(m){
 if(!keys(m,['version','value','quantity','time','sources','references','decoderVersion','integrity','completion','note','resourcePolicy','computation','synchronization','statisticalUncertainty','spectrum','cusum','coordinateAlignment','coordinateAxis','weightedFit'])||![1,2].includes(m.version)||(m.version===2?!validDatasetResourcePolicy(m.resourcePolicy):m.resourcePolicy!==undefined))return false;
 const v=m.value;
 return keys(v,['spelling','representation','radix','unit','presence'])&&(m.version===2?validPolicyScalar({spelling:v.spelling,representation:v.representation,radix:v.radix},m.resourcePolicy):text(v.spelling,8192))&&REPRESENTATIONS.includes(v.representation)&&v.representation!=='domain'&&Number.isInteger(v.radix)&&v.radix>=2&&v.radix<=36&&text(v.unit,100)&&['value','missing','null','absent','unknown'].includes(v.presence)&&(v.presence!=='value'||m.version===2||supportedValue(v.spelling,v.representation,v.radix))&&
 (m.weightedFit===undefined||validWeightedFitContext(m.weightedFit))&&(m.coordinateAlignment===undefined||validCoordinateAlignmentMeasurement(m.coordinateAlignment))&&(m.coordinateAxis===undefined||validCoordinateAlignmentAxis(m.coordinateAxis))&&(m.cusum===undefined||validCusumDescriptor(m.cusum))&&(m.spectrum===undefined||validSpectrumDescriptor(m.spectrum))&&(m.statisticalUncertainty===undefined||validStatisticalUncertaintyDescriptor(m.statisticalUncertainty))&&(m.synchronization===undefined||validClockSynchronizationDescriptor(m.synchronization))&&(m.computation===undefined||validComputation(m.computation)&&!perCellComputation(m.computation))&&validQuantity(m.quantity,v.unit)&&validTime(m.time)&&Array.isArray(m.sources)&&m.sources.length>0&&m.sources.length<=32&&m.sources.every(validLocator)&&keys(m.references,MEASUREMENT_ROLES)&&MEASUREMENT_ROLES.every(k=>optionalRef(m.references[k]))&&text(m.decoderVersion,300)&&(!m.references.decoder||!!m.decoderVersion.trim())&&['unknown','verified','failed','not-checked'].includes(m.integrity)&&['unknown','complete','partial'].includes(m.completion)&&text(m.note,10000);
}
export function measurementReferences(m){return [...m.sources.map(s=>s.ref),...Object.values(m.references),...schemaReferences(m)].filter(Boolean);}

// Structural readers do not fetch retained text. Submission and authenticated
// selected readers call this only after resolving the declared scalar fields.
export function validateMeasurementDeclaration(value,{budget}={}){
 if(value?.weightedFit){const context=value.weightedFit;if(!validWeightedFitContext(context))throw RangeError('Invalid weighted fit context');validatePolicyScalar(context.referenceX,context.resourcePolicy,{budget});if(context.evaluationX)validatePolicyScalar(context.evaluationX,context.resourcePolicy,{budget});if(context.coordinateUnit.definition)validateUnitDefinition(context.coordinateUnit.definition,{budget});}
 if(value?.synchronization)validateClockSynchronizationDescriptor(value.synchronization,{budget});
 if(value?.quantity?.unitDefinition)validateUnitDefinition(value.quantity.unitDefinition,{budget});
 if(value?.quantity?.uncertainty)validateIntervalUncertainty(value.quantity.uncertainty,{budget});
 if(value?.time?.clock?.definition)validateClockDefinition(value.time.clock.definition,{budget});
 if(value?.value&&value.version===2){if(!validMeasurement(value))throw RangeError('Invalid measurement declaration');if(value.value.presence==='value')validatePolicyScalar({spelling:value.value.spelling,representation:value.value.representation,radix:value.value.radix},value.resourcePolicy,{budget});}
 else if(value?.resourcePolicy!==undefined&&!validDatasetResourcePolicy(value.resourcePolicy))throw RangeError('Invalid scalar interpretation policy');
 return value;
}
