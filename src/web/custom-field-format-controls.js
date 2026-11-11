import {TEXT_FIELD_FORMATS} from './custom-field-formats.js';
import {customFieldText as tr} from './custom-field-presentation.js';

// Shared by Preferences, the lab book editor and the configuration editor.
export function fieldTextFormatControls(value,{field,option},attributes){
 if(value.type!=='text')return '';
 return '<div class="form-grid">'+field(tr('textFormat'),'<select '+attributes('format')+'>'+option('',tr('formats.free'),value.format??'')+TEXT_FIELD_FORMATS.map(key=>option(key,tr('formats.'+key),value.format??'')).join('')+'</select>')+'</div>';
}
