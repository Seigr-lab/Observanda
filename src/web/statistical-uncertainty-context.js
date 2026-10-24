import {t} from './i18n/index.js';
import {validCalculationPolicy} from './tools/calculation-policy.js';
const message=(key,args)=>t('statisticalUncertainty',key,args);
// Emit only interpretation. Definition/analysis identities, source locations and
// runtime budgets belong to the private retained recipe, never table labels.
export function statisticalUncertaintyContextText(context,{text=message}={}){
 if(!context)return '';
 if(context.version!==1||context.method!=='first-order-covariance-v1'||!['nominal','variance','standard'].includes(context.role))throw RangeError('Invalid statistical uncertainty context');
 let result=text('publicContext',{method:text('publicMethod'),role:text('publicRole-'+context.role)});
 if(context.role==='standard'){
  const root=context.squareRoot;
  if(root?.engine!==4||typeof root.approximate!=='boolean'||!validCalculationPolicy(root.policy)||root.policy.version!==2)throw RangeError('Invalid statistical square-root context');
  const kind=text(root.approximate?'publicApproximateRoot':'publicExactRoot');
  result+='; '+(root.approximate?text('publicRootPolicy',{kind,digits:root.policy.workingDigits,rounding:root.policy.rounding,library:root.policy.library.name,version:root.policy.library.version}):kind);
 }else if(context.squareRoot!==undefined)throw RangeError('Unexpected statistical square-root context');
 return result;
}
