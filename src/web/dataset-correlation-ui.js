import {t} from './i18n/index.js';
import {defaultStructuredCalculationPolicy,validCalculationPolicy} from './tools/calculation-policy.js';
import {calculationPolicyControls,calculationPolicyInput} from './tools/calculation-policy-ui.js';
export const CORRELATION_METHOD='pearson-centered-pairs-v1';
export const correlationText=(key,args)=>t('datasetAggregation',key,args);
export const correlationStatuses=Object.freeze(['ready','no-pairs','insufficient-pairs','zero-x-spread','zero-y-spread','zero-both-spread']);
export function correlationStatusText(status,{text=correlationText}={}){if(!correlationStatuses.includes(status))throw RangeError(text('correlationInvalidStatus'));return text('correlationStatus-'+status);}
export function correlationPolicyDescription(policy,{text=correlationText}={}){if(!validCalculationPolicy(policy)||policy.version!==2)throw RangeError(text('correlationInvalidPolicy'));return text('correlationPrecision',{digits:policy.workingDigits,display:policy.displayDigits,rounding:t('calculator','rounding-'+policy.rounding),library:policy.library.name,version:policy.library.version});}
export function correlationControls(metric,{esc,field,text=correlationText}={}){
 const policy=metric.calculationPolicy??defaultStructuredCalculationPolicy(),c={field,disclosure:()=>'',option:(value,label,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>'};
 return '<div data-aggregate-correlation'+(metric.operation==='correlation'?'':' hidden')+' data-correlation-policy="'+esc(JSON.stringify(policy))+'">'+field(esc(text('correlationMethod')),'<select data-correlation-method><option value="'+CORRELATION_METHOD+'">'+esc(text(CORRELATION_METHOD))+'</option></select>')+calculationPolicyControls({engine:4,policy},c,esc)+'<details data-correlation-method-help><summary>'+esc(text('correlationMethodHelp'))+'</summary><p>'+esc(text('correlationRules'))+'</p><p>'+esc(text('correlationExactFirst'))+'</p><p>'+esc(text('correlationNoInference'))+'</p></details></div>';
}
export function readCorrelationControls(root,{validate=false,text=correlationText}={}){
 const area=root.querySelector('[data-aggregate-correlation]'),method=area.querySelector('[data-correlation-method]').value,calculationPolicy=JSON.parse(area.dataset.correlationPolicy);
 for(const input of area.querySelectorAll('[data-calculation-policy]')){const key=input.dataset.calculationPolicy,target=Object.hasOwn(calculationPolicy,key)?calculationPolicy:calculationPolicy.resources;target[key]=key==='rounding'?input.value:input.value===''?null:Number(input.value);}
 if(validate&&(method!==CORRELATION_METHOD||!validCalculationPolicy(calculationPolicy)||calculationPolicy.version!==2))throw RangeError(text('correlationInvalidPolicy'));
 return {method,calculationPolicy};
}
export function wireCorrelationControls(root){
 const controller=new AbortController();root.addEventListener('input',event=>{if(!event.target.matches('[data-calculation-policy]'))return;const area=event.target.closest('[data-aggregate-correlation]');if(!area)return;const policy=JSON.parse(area.dataset.correlationPolicy);calculationPolicyInput(event.target,{engine:4,policy});area.dataset.correlationPolicy=JSON.stringify(policy);},{signal:controller.signal});return ()=>controller.abort();
}
