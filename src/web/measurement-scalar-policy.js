// A retained interpretation owns its limits independently of the operation using it.
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy,DatasetResourceError} from './dataset-resource-policy.js';
import {validNumeralContext} from './numeral-context.js';
import {exactRational} from './measurement-rational.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const indexRef=v=>exact(v,['count','hash','height','key'])&&hash(v.hash)&&hash(v.key)&&Number.isSafeInteger(v.height)&&v.height>0&&v.height<=76&&Number.isSafeInteger(v.count)&&v.count>=v.height;
const textParts=(v,characters)=>exact(v,['format','kind','root','count','chunkSize'])&&v.format===1&&v.kind==='cell-text'&&v.chunkSize===16&&v.count===Math.ceil(characters/16384)&&indexRef(v.root)&&v.root.count===Math.ceil(v.count/16);
export const scalarTextReference=v=>exact(v,['format','version','characters','sha256','parts'])&&v.format==='dataset-cell'&&v.version===1&&Number.isSafeInteger(v.characters)&&v.characters>4096&&typeof v.sha256==='string'&&/^[a-f0-9]{64}$/.test(v.sha256)&&textParts(v.parts,v.characters);
export function validPolicyScalar(value,policy){return validDatasetResourcePolicy(policy)&&exact(value,['spelling','representation','radix'])&&validNumeralContext({version:1,representation:value.representation,radix:value.radix})&&(typeof value.spelling==='string'?value.spelling.length<=policy.resources.maxScalarCharacters&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.spelling):scalarTextReference(value.spelling)&&value.spelling.characters<=policy.resources.maxScalarCharacters);}
// Both budgets see the same work. Parsing cannot borrow a larger exponent, bit,
// text, operation or time allowance from its consumer. I/O occurs before run().
export function withScalarPolicy(policy,caller,operation){
 if(!validDatasetResourcePolicy(policy))throw RangeError('Invalid scalar interpretation policy');
 const owner=new DatasetResourceBudget(policy),budgets=caller?[owner,caller]:[owner],resources={...policy.resources};
 if(caller?.scalarPolicy)for(const key of Object.keys(resources))resources[key]=Math.min(resources[key],caller.scalarPolicy.resources[key]);
 const bits=n=>(n<0n?-n:n).toString(2).length;
 const budget={scalarPolicy:{...policy,resources},maxBits:Math.min(...budgets.map(b=>b.maxBits)),step(){for(const b of budgets)b.step();},size(...values){for(const b of budgets)b.size(...values);},product(a,b){this.step();if(a!==0n&&b!==0n&&bits(a)+bits(b)-1>this.maxBits)scalarResourceFailure();return a*b;},power(a,n){this.step();if(n<0n||n>BigInt(this.maxBits)||(a<0n?-a:a)>1n&&BigInt(bits(a)-1)*n>BigInt(this.maxBits))scalarResourceFailure();const result=a**n;this.size(result);return result;}};
 return owner.run(()=>caller?.run?caller.run(()=>operation(budget)):operation(budget));
}
export function validatePolicyScalar(value,policy,{budget}={}){
 if(!exact(value,['spelling','representation','radix'])||!validNumeralContext({version:1,representation:value.representation,radix:value.radix})||!validDatasetResourcePolicy(policy))throw RangeError('Invalid exact scalar declaration');
 if(typeof value.spelling!=='string')throw RangeError('Resolve the selected retained scalar before arithmetic');
 return withScalarPolicy(policy,budget,b=>exactRational(value.spelling,value.representation,value.radix,b));
}
export function isScalarResourceFailure(error){return error?.code==='DATASET_CALCULATION_RESOURCE'||/calculation resource budget/.test(error?.message??'');}
export function scalarResourceFailure(){throw new DatasetResourceError();}
