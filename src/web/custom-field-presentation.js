import {t} from './i18n/index.js';
import {fieldNumberContext,fieldNumberUsesRadix} from './custom-field-numbers.js';
import {profileText} from './laboratory/profile-text.js';
export const customFieldText=(key,args)=>t('customFields',key,args);
export function fieldNumberLabel(field){
 const {representation,radix}=fieldNumberContext(field);
 return customFieldText(fieldNumberUsesRadix(representation)?'context.'+representation:'numbers.'+representation,{radix});
}
// Labels, units and choices copied from a lab book profile display in the
// interface language; stored values and authored text stay as they are.
export const customFieldLabel=field=>profileText(field.label)+(field.unit?' ('+profileText(field.unit)+')':'')+(field.type==='number'&&field.numeric?' · '+fieldNumberLabel(field):'')+(field.type==='text'&&field.format?' · '+customFieldText('formats.'+field.format):'');
export const customFieldValueText=(field,value)=>field?.type==='select'?profileText(value):value;
export {profileText as templateText};
