import {t} from './i18n/index.js';
import {fieldNumberContext,fieldNumberUsesRadix} from './custom-field-numbers.js';
export const customFieldText=(key,args)=>t('customFields',key,args);
export function fieldNumberLabel(field){
 const {representation,radix}=fieldNumberContext(field);
 return customFieldText(fieldNumberUsesRadix(representation)?'context.'+representation:'numbers.'+representation,{radix});
}
export const customFieldLabel=field=>field.label+(field.unit?' ('+field.unit+')':'')+(field.type==='number'&&field.numeric?' · '+fieldNumberLabel(field):'');
