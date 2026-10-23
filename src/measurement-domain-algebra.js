import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {DomainAlgebraError,domainAlgebraShape} from './web/measurement-domain-algebra-model.js';
import {domainCodec,domainComponentCount} from './web/measurement-domain-model.js';
import {defaultColumn} from './web/dataset-schema.js';
import {blankQuantity} from './web/measurement-model.js';
import {validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {exactRational} from './web/measurement-rational.js';
import {formatExactResult} from './web/measurement-format.js';
import {unitOperationDimensions,canonicalUnitValue,fromCanonicalUnitValue,addUnitRational,multiplyUnitRational,divideUnitRational,exactUnitScalar} from './web/measurement-unit-model.js';
import {validateDomainValue,domainValueSupported,retainDomainComponents} from './measurement-domain-storage.js';
import {datasetCellReference} from './dataset-cell-storage.js';
import {graphScalarCell} from './dataset-resource-values.js';
const rationalContext={version:1,representation:'rational',radix:10};
const fail=(code='MEASUREMENT_DOMAIN_INCOMPATIBLE')=>{throw new AppError(code);};
const declared=column=>column.quantity?.unitDefinition??null;
const productOperation=operation=>!['add','subtract'].includes(operation);
const zero=()=>({numerator:0n,denominator:1n});
const negate=value=>({...value,numerator:-value.numerator});
function handled(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;if(error instanceof DomainAlgebraError)fail(error.code);fail();}
function outputUnitsInner(operation,left,right,policy,budget){
 const a=declared(left),b=declared(right),quantity={...blankQuantity(),origin:'derived'};
 if(!a&&!b){if(productOperation(operation)?left.unit!==''||right.unit!=='':left.unit!==right.unit)fail();return {unit:productOperation(operation)?'':left.unit,quantity};}
 if(!a||!b)fail();
 const action=productOperation(operation)?operation==='divide'?'divide':'multiply':operation,result=unitOperationDimensions(action,a,b,null,budget);
 let selected=null;if(!productOperation(operation))selected=result.kind==='absolute'?(a.kind==='absolute'?left:right):left;
 const unitDefinition={version:2,resourcePolicy:structuredClone(policy),kind:result.kind,dimensions:result.dimensions,scale:selected?structuredClone(declared(selected).scale):exactUnitScalar('1'),offset:result.kind==='absolute'?structuredClone(declared(selected).offset):exactUnitScalar('0')};
 return {unit:selected?.unit??'',quantity:{...quantity,unitDefinition}};
}
function unitOperation(operation){try{return operation();}catch(error){if(isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail('MEASUREMENT_DOMAIN_UNITS');}}
const outputUnits=(...args)=>unitOperation(()=>outputUnitsInner(...args));
export function domainAlgebraColumn(node,columns,{policy}={}){
 try{
  if(!validDatasetResourcePolicy(policy)||columns.length!==2||columns.some(column=>column?.representation!=='domain'))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');
  const [left,right]=columns,shape=domainAlgebraShape(node.operation,left.domain,right.domain),budget=new DatasetResourceBudget(policy),units=numericalOperation(budget,b=>outputUnits(node.operation,left,right,policy,b));
  return {...defaultColumn({label:left.name||'Value'}),...units,missing:[],representation:shape.codec?'domain':'rational',radix:10,...(shape.codec?{domain:{version:2,codec:'observanda.'+shape.codec,codecVersion:1,namespace:left.domain.namespace,shape:shape.shape,component:{...rationalContext},resourcePolicy:structuredClone(policy)}}:{resourcePolicy:structuredClone(policy)})};
 }catch(error){handled(error);}
}
// Raw cache only. Every use reparses its selected component against the same
// output budget, so reused components never provide uncharged arithmetic work.
class ComponentReader{
 constructor(materials,values,{policy,signal,check}){Object.assign(this,{materials,values,policy,signal,check});this.pages=new Map();}
 async current(){this.signal?.throwIfAborted();await this.check();this.signal?.throwIfAborted();}
 async read(side,index,budget){
  await this.current();const value=this.values[side],definition=value.definition;if(!Number.isSafeInteger(index)||index<0||index>=value.components.count)fail('MATERIAL_MISSING');
  const offset=Math.floor(index/16)*16,key=side+':'+offset;let page=this.pages.get(key);
  if(!page){page=await this.materials.sequences.page(value.components,{offset,limit:16});await this.current();if(page.offset!==offset||page.items.length!==Math.min(16,value.components.count-offset))fail('MATERIAL_MISSING');this.pages.set(key,page);if(this.pages.size>3)this.pages.delete(this.pages.keys().next().value);}
  else{this.pages.delete(key);this.pages.set(key,page);}
  const item=page.items[index-offset];if(!item||Object.keys(item).length!==1||!Object.hasOwn(item,'spelling'))fail('MATERIAL_MISSING');let spelling=item.spelling;
  numericalOperation(budget,b=>b.step());if(spelling===null)return null;
  if(typeof spelling!=='string'){
   if(value.version!==3||!datasetCellReference(spelling))fail('MATERIAL_MISSING');const retained=spelling;spelling=(await graphScalarCell(this.materials,{kind:'string',value:retained},definition.resourcePolicy,{signal:this.signal})).value;await this.current();
   if(createHash('sha256').update(spelling,'utf16le').digest('hex')!==retained.sha256)fail('MATERIAL_MISSING');
  }
  if(definition.version===2)return validatePolicyScalar({spelling,representation:definition.component.representation,radix:definition.component.radix},definition.resourcePolicy,{budget});
  if(spelling.length>8192)fail('MEASUREMENT_DOMAIN_COMPONENT_LIMIT');
  const scoped={scalarPolicy:{...this.policy,resources:{...this.policy.resources,maxScalarCharacters:Math.min(8192,this.policy.resources.maxScalarCharacters),maxExponent:Math.min(8192,this.policy.resources.maxExponent)}},maxBits:budget.maxBits,step:()=>budget.step(),size:(...v)=>budget.size(...v),product:(a,b)=>budget.product(a,b),power:(a,n)=>budget.power(a,n)};
  return numericalOperation(budget,()=>exactRational(spelling,definition.component.representation,definition.component.radix,scoped));
 }
}
const present=(cell,column)=>cell&&!['absent','null'].includes(cell.kind)&&!column.missing.some(item=>item.value===cell.value);
export async function calculateDomainAlgebraNode(materials,node,cells,columns,{policy,write=fn=>fn(),signal,check=async()=>{}}={}){
 try{
  const output=domainAlgebraColumn(node,columns,{policy});signal?.throwIfAborted();await check();if(cells.length!==2)fail();if(cells.some((cell,index)=>!present(cell,columns[index])))return {kind:'absent',value:''};
  const values=cells.map((cell,index)=>validateDomainValue(materials,cell.value,columns[index].domain));if(values.some(value=>!domainValueSupported(value)))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');
  const reader=new ComponentReader(materials,values,{policy,signal,check}),operation=node.operation;
  const read=async(side,index,budget)=>{const value=await reader.read(side,index,budget);return value&&declared(columns[side])?numericalOperation(budget,b=>unitOperation(()=>canonicalUnitValue(value,declared(columns[side]),b))):value;};
  async function component(index,budget){
   if(['add','subtract'].includes(operation)){const a=await read(0,index,budget),b=await read(1,index,budget);return !a||!b?null:numericalOperation(budget,budget=>addUnitRational(a,operation==='subtract'?negate(b):b,budget));}
   if(operation==='dot'||operation==='matmul'){
    const length=operation==='dot'?columns[0].domain.shape[0]:columns[0].domain.shape[1],row=operation==='dot'?0:Math.floor(index/output.domain.shape[1]),col=operation==='dot'?0:index%output.domain.shape[1];let sum=zero(),missing=false;
    for(let k=0;k<length;k++){signal?.throwIfAborted();const left=await read(0,operation==='dot'?k:row*length+k,budget),right=await read(1,operation==='dot'?k:k*columns[1].domain.shape[1]+col,budget);if(!left||!right)missing=true;else sum=numericalOperation(budget,b=>addUnitRational(sum,multiplyUnitRational(left,right,b),b));}
    return missing?null:sum;
   }
   const a=await read(0,0,budget),b=await read(0,1,budget),c=await read(1,0,budget),d=await read(1,1,budget);
   return numericalOperation(budget,budget=>{
    let denominator=null;if(operation==='divide'&&c&&d){denominator=addUnitRational(multiplyUnitRational(c,c,budget),multiplyUnitRational(d,d,budget),budget);if(denominator.numerator===0n)fail('MEASUREMENT_DOMAIN_ZERO_DIVISOR');}
    if(!a||!b||!c||!d)return null;
    const left=index===0?multiplyUnitRational(a,c,budget):multiplyUnitRational(b,c,budget),right=index===0?multiplyUnitRational(b,d,budget):multiplyUnitRational(a,d,budget);
    const numerator=addUnitRational(left,operation==='multiply'?(index===0?negate(right):right):(index===0?right:negate(right)),budget);
    return operation==='divide'?divideUnitRational(numerator,denominator,budget):numerator;
   });
  }
  async function result(index){const budget=new DatasetResourceBudget(policy);let exact=await component(index,budget);if(exact&&declared(output))exact=numericalOperation(budget,b=>unitOperation(()=>fromCanonicalUnitValue(exact,declared(output),b)));const spelling=exact?numericalOperation(budget,b=>formatExactResult(exact,rationalContext,b)):null;return {spelling,budget};}
  if(output.representation==='rational'){const value=await result(0);await reader.current();return value.spelling===null?{kind:'null',value:''}:{kind:'string',value:value.spelling};}
  async function* components(){for(let index=0;index<domainComponentCount(output.domain);index++){signal?.throwIfAborted();yield await result(index);}}
  const value=await retainDomainComponents(materials,output.domain,components(),write,{signal});await reader.current();return {kind:'string',value};
 }catch(error){handled(error);}
}
