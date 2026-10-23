// Version 3 retains its numerical contract; earlier engines keep their own defaults.
export const calculationLibrary=Object.freeze({name:'mathjs',version:'15.2.0'});
export const policyLimits=Object.freeze({workingDigits:[16,256],displayDigits:[1,256],maxBits:[64,65536],maxOperations:[1,50000],maxMilliseconds:[1,5000]});
export const policyRounding=Object.freeze(['half-even','half-up','toward-zero','floor','ceiling']);
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const bounded=(value,key)=>Number.isSafeInteger(value)&&value>=policyLimits[key][0]&&value<=policyLimits[key][1];
export function defaultCalculationPolicy(){return {version:1,library:{...calculationLibrary},workingDigits:64,displayDigits:32,rounding:'half-even',resources:{maxBits:65536,maxOperations:50000,maxMilliseconds:2500}};}
export function validCalculationPolicy(value){return exact(value,['version','library','workingDigits','displayDigits','rounding','resources'])&&value.version===1&&exact(value.library,['name','version'])&&value.library.name==='mathjs'&&typeof value.library.version==='string'&&/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.library.version)&&bounded(value.workingDigits,'workingDigits')&&bounded(value.displayDigits,'displayDigits')&&value.displayDigits<=value.workingDigits&&policyRounding.includes(value.rounding)&&exact(value.resources,['maxBits','maxOperations','maxMilliseconds'])&&Object.keys(value.resources).every(k=>bounded(value.resources[k],k));}
export const hasCalculationPolicy=(type,data)=>['calculation','sheet'].includes(type)&&data?.engine===3;
export function checkpointHasCalculationPolicy(value){return Array.isArray(value?.drafts)&&value.drafts.some(d=>hasCalculationPolicy(d?.type,d?.data)||hasCalculationPolicy(d?.type,d?.base)||hasCalculationPolicy(d?.type,d?.operation?.values)||hasCalculationPolicy(d?.type,d?.operation?.base));}
export function calculationWorkerTimeout(data){return data?.engine===3&&validCalculationPolicy(data.policy)?data.policy.resources.maxMilliseconds+2500:5000;}
