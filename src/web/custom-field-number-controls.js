import {FIELD_NUMBER_REPRESENTATIONS,fieldNumberContext,fieldNumberUsesRadix} from './custom-field-numbers.js';
import {customFieldText as tr} from './custom-field-presentation.js';

export function fieldNumberControls(value,{field,option,esc},attributes){
 if(value.type!=='number')return '';
 const context=fieldNumberContext(value);
 return '<div class="form-grid">'+field(tr('numberFormat'),'<select '+attributes('numericRepresentation')+'>'+FIELD_NUMBER_REPRESENTATIONS.map(key=>option(key,tr('numbers.'+key),context.representation)).join('')+'</select>')+
  (fieldNumberUsesRadix(context.representation)?field(tr('radix'),'<input '+attributes('numericRadix')+' type="number" min="2" max="36" step="1" required value="'+esc(context.radix)+'">'):'')+'</div>';
}
