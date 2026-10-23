// Scientific values remain strings. Arithmetic here only constructs exact rational
// identities; no unit conversion or clock unwrapping is inferred.
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
export const REPRESENTATIONS=['text','decimal','integer','radix','radix-fraction','rational','unsupported'];
export const QUANTITY_ORIGINS=['unspecified','requested','measured','derived','raw-code'];
export const TIME_KINDS=['none','unknown','acquisition-order','counter','wall-clock','elapsed','powered-duration','inferred-elapsed','external'];
export const MEASUREMENT_ROLES=['decoder','schema'];
const text=(v,max=2000)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const keys=(v,list)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>list.includes(k));
export const measurementRef=r=>keys(r,['kind','id','revision','workspaceId','label'])&&['artifact','dataset','analysis','collection','record'].includes(r.kind)&&researchId(r.id)&&revisionId(r.revision)&&(r.workspaceId===undefined||researchId(r.workspaceId))&&(r.label===undefined||text(r.label,300));
const optionalRef=r=>r===null||measurementRef(r);
const uint=v=>Number.isSafeInteger(v)&&v>=0;
export function exactRational(value,representation='decimal',radix=10){
 if(representation==='rational'){
  if(!text(value,8192)||!/^[-+]?\d+\/[1-9]\d*$/.test(value))throw Error('value');
  let [n,d]=value.split('/').map(BigInt),a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];a||=1n;return {numerator:n/a,denominator:d/a};
 }
 if(!text(value,8192)||!['decimal','integer','radix','radix-fraction'].includes(representation))throw Error('representation');
 let sign=1n,source=value;if(source[0]==='-'){sign=-1n;source=source.slice(1);}else if(source[0]==='+')source=source.slice(1);
 let exponent=0;
 if(representation==='decimal'){
  if(!/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(source))throw Error('value');
  const parts=source.toLowerCase().split('e');source=parts[0];exponent=Number(parts[1]??0);
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>8192)throw Error('exponent');radix=10;
 }else if(representation==='integer')radix=10;
 if(!Number.isInteger(radix)||radix<2||radix>36||!(/^(?:[0-9a-z]+\.?[0-9a-z]*|\.[0-9a-z]+)$/i.test(source))||['integer','radix'].includes(representation)&&source.includes('.'))throw Error('value');
 const [whole,fraction='']=source.toLowerCase().split('.');let numerator=0n;
 for(const digit of whole+fraction){const n=parseInt(digit,36);if(n>=radix)throw Error('digit');numerator=numerator*BigInt(radix)+BigInt(n);}
 let denominator=BigInt(radix)**BigInt(fraction.length);
 if(exponent>0)numerator*=10n**BigInt(exponent);else if(exponent<0)denominator*=10n**BigInt(-exponent);
 let a=numerator,b=denominator;while(b){[a,b]=[b,a%b];}const divisor=a||1n;
 return {numerator:sign*numerator/divisor,denominator:denominator/divisor};
}
export function supportedValue(value,representation,radix){
 if(['text','unsupported'].includes(representation))return text(value,262144);
 try{exactRational(value,representation,radix);return true;}catch{return false;}
}
export function rationalIdentity(value){
 if(value.presence!=='value'||['text','unsupported'].includes(value.representation))return null;
 const rational=exactRational(value.spelling,value.representation,value.radix);
 return {numerator:String(rational.numerator),denominator:String(rational.denominator)};
}
export const blankQuantity=()=>({origin:'unspecified',conversion:null,calibration:null});
export function validQuantity(q,unit){return keys(q,['origin','conversion','calibration'])&&QUANTITY_ORIGINS.includes(q.origin)&&optionalRef(q.conversion)&&optionalRef(q.calibration)&&(q.origin!=='raw-code'||unit==='');}
export const blankClock=()=>({width:null,frequency:'',ordering:'unknown',wrap:'unknown',reset:'unknown',epoch:'',model:null,referenceData:null});
export function validTime(time){
 if(!keys(time,['kind','reference','resolution','uncertainty','clock'])||!TIME_KINDS.includes(time.kind)||!['reference','resolution','uncertainty'].every(k=>text(time[k],500)))return false;
 if(time.clock===undefined)return time.kind!=='external';
 const c=time.clock;if(!keys(c,['width','frequency','ordering','wrap','reset','epoch','model','referenceData'])||!(c.width===null||Number.isInteger(c.width)&&c.width>=1&&c.width<=4096)||!text(c.frequency,200)||!['unknown','source','monotonic','unordered'].includes(c.ordering)||!['unknown','none','modulo','observed'].includes(c.wrap)||!['unknown','none','observed'].includes(c.reset)||!text(c.epoch,500)||!optionalRef(c.model)||!optionalRef(c.referenceData))return false;
 if(c.frequency){try{if(exactRational(c.frequency).numerator<=0n)return false;}catch{return false;}}
 return time.kind!=='external'||!!c.model&&!!c.referenceData;
}
export function schemaReferences(column){return [column.quantity?.conversion,column.quantity?.calibration,column.time?.clock?.model,column.time?.clock?.referenceData].filter(Boolean);}
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
 if(!keys(m,['version','value','quantity','time','sources','references','decoderVersion','integrity','completion','note'])||m.version!==1)return false;
 const v=m.value;
 return keys(v,['spelling','representation','radix','unit','presence'])&&text(v.spelling,8192)&&REPRESENTATIONS.includes(v.representation)&&Number.isInteger(v.radix)&&v.radix>=2&&v.radix<=36&&text(v.unit,100)&&['value','missing','null','absent','unknown'].includes(v.presence)&&(v.presence!=='value'||supportedValue(v.spelling,v.representation,v.radix))&&
 validQuantity(m.quantity,v.unit)&&validTime(m.time)&&Array.isArray(m.sources)&&m.sources.length>0&&m.sources.length<=32&&m.sources.every(validLocator)&&keys(m.references,MEASUREMENT_ROLES)&&MEASUREMENT_ROLES.every(k=>optionalRef(m.references[k]))&&text(m.decoderVersion,300)&&(!m.references.decoder||!!m.decoderVersion.trim())&&['unknown','verified','failed','not-checked'].includes(m.integrity)&&['unknown','complete','partial'].includes(m.completion)&&text(m.note,10000);
}
export function measurementReferences(m){return [...m.sources.map(s=>s.ref),...Object.values(m.references),...schemaReferences(m)].filter(Boolean);}
