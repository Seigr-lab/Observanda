import {t} from '../i18n/index.js';
import {policyLimits,policyRounding,validCalculationPolicy} from './calculation-policy.js';
const tr=(key,values)=>t('calculator',key,values);
export function calculationPolicyControls(data,c,esc){
 const p=data.policy;if(data.engine!==3)return '';
 const input=(key)=>{const value=Object.hasOwn(p,key)?p[key]:p.resources[key],[min,max]=policyLimits[key];return c.field(tr(key),'<input type="number" data-calculation-policy="'+key+'" value="'+esc(value)+'" min="'+min+'" max="'+(key==='displayDigits'?p.workingDigits:max)+'" step="1" required>');};
 return '<details '+c.disclosure('calculation-policy')+' data-calculation-policy-panel><summary>'+esc(tr('policy'))+'</summary><div class="tool-fields calculation-policy-fields">'+input('workingDigits')+input('displayDigits')+c.field(tr('rounding'),'<select data-calculation-policy="rounding">'+policyRounding.map(value=>c.option(value,tr('rounding-'+value),p.rounding)).join('')+'</select>')+input('maxBits')+input('maxOperations')+input('maxMilliseconds')+'</div><p class="muted">'+esc(tr('policyMeaning'))+'</p><p class="muted">'+esc(tr('policyEngine',{version:p.library.version}))+'</p></details>';
}
export function calculationPolicyInput(el,data){
 const key=el.dataset.calculationPolicy;if(!key||data.engine!==3)return false;
 if(key==='rounding')data.policy.rounding=el.value;
 else if(Object.hasOwn(policyLimits,key)){const target=Object.hasOwn(data.policy,key)?data.policy:data.policy.resources;target[key]=el.value===''?null:Number(el.value);}
 else return false;
 const panel=el.closest('[data-calculation-policy-panel]'),display=panel?.querySelector('[data-calculation-policy="displayDigits"]');
 if(display)display.max=String(data.policy.workingDigits);
 const working=panel?.querySelector('[data-calculation-policy="workingDigits"]');
 working?.setCustomValidity(validCalculationPolicy(data.policy)?'':tr('invalidPolicy'));
 return true;
}
export const approximationTitle=value=>value?.engine===3?tr('policyApproximation',{working:value.workingDigits,display:value.displayDigits,rounding:tr('rounding-'+value.rounding)}):tr('approximateInfo');

const policyErrorKeys={CALCULATION_POLICY_LEGACY:'policyLegacyError',CALCULATION_POLICY_INVALID:'invalidPolicy',CALCULATION_LIBRARY_UNAVAILABLE:'policyLibraryError',CALCULATION_REAL_RESULT:'policyRealError'};
export const calculationErrorText=value=>Object.hasOwn(policyErrorKeys,value?.errorCode??'')?tr(policyErrorKeys[value.errorCode]):value?.error??'';
