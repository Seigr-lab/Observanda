// Declared native domains never infer numerical semantics from a label or glyph.
import {validIntervalDomain} from './measurement-interval-model.js';
import {validNumeralContext} from './numeral-context.js';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,names)=>object(value)&&Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));
const positive=value=>Number.isSafeInteger(value)&&value>0;
const label=value=>typeof value==='string'&&value.length<=200&&!/[\u0000-\u001f]/u.test(value);
export const DOMAIN_CODECS=['symbol','vector','matrix','complex','interval'];
export const domainCodec=domain=>domain?.codec?.startsWith('observanda.')?domain.codec.slice(11):null;
export function knownDomain(domain){return domain?.version===1&&domain.codecVersion===1&&DOMAIN_CODECS.includes(domainCodec(domain))&&(domainCodec(domain)!=='interval'||validIntervalDomain(domain));}
export function domainComponentCount(domain){let count=1;for(const length of domain.shape){count*=length;if(!Number.isSafeInteger(count))throw Error('Domain shape exceeds exact indexing capacity');}return domain.shape.length?count:0;}
export function validDomainDefinition(domain){
 if(!exact(domain,['version','codec','codecVersion','namespace','shape','component'])||domain.version!==1||!positive(domain.codecVersion)||!label(domain.codec)||!domain.codec||!label(domain.namespace)||!Array.isArray(domain.shape)||domain.shape.length>16||!domain.shape.every(positive))return false;
 try{domainComponentCount(domain);}catch{return false;}
 const component=domain.component;
 if(component!==null&&(!exact(component,['version','representation','radix'])||!positive(component.version)||!label(component.representation)||!positive(component.radix)))return false;
 if(!knownDomain(domain))return true;
 const codec=domainCodec(domain);if(codec==='symbol')return domain.shape.length===0&&component===null;
 return validNumeralContext(component)&&(codec==='vector'?domain.shape.length===1:codec==='matrix'?domain.shape.length===2:domain.shape.length===1&&domain.shape[0]===2);
}
export function domainCapabilities(domain){const supported=validDomainDefinition(domain)&&knownDomain(domain),numeric=supported&&domainCodec(domain)!=='symbol';return {supported,equality:supported,ordering:false,copy:supported,choose:supported,extract:numeric,componentPlot:numeric};}
export function sameDomainSpace(a,b){return validDomainDefinition(a)&&validDomainDefinition(b)&&knownDomain(a)&&knownDomain(b)&&a.version===b.version&&a.codec===b.codec&&a.codecVersion===b.codecVersion&&a.namespace===b.namespace&&a.shape.length===b.shape.length&&a.shape.every((value,i)=>value===b.shape[i]);}
export function domainComponentIndex(domain,position){
 if(!domainCapabilities(domain).extract||!Array.isArray(position)||position.length!==domain.shape.length)throw Error('A supported domain component is required');
 let index=0;for(let i=0;i<position.length;i++){if(!Number.isSafeInteger(position[i])||position[i]<0||position[i]>=domain.shape[i])throw Error('Component lies outside the declared shape');index=index*domain.shape[i]+position[i];}return index;
}
export function domainComponentPosition(domain,index){
 if(!Number.isSafeInteger(index)||index<0||index>=domainComponentCount(domain))throw Error('Invalid component index');const result=Array(domain.shape.length);for(let i=domain.shape.length-1;i>=0;i--){result[i]=index%domain.shape[i];index=Math.floor(index/domain.shape[i]);}return result;
}
export function defaultDomain(codec='vector'){if(!DOMAIN_CODECS.includes(codec))throw Error('Unknown domain codec');return {version:1,codec:'observanda.'+codec,codecVersion:1,namespace:'',shape:codec==='symbol'?[]:codec==='matrix'?[2,2]:[2],component:codec==='symbol'?null:{version:1,representation:'decimal',radix:10}};}
