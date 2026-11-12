import {semanticRoles} from './semantic-text-styles.js';

export function semanticTextTools(text){
 const label=key=>text('style'+key),field=(title,input)=>'<label>'+label(title)+input+'</label>';
 const roles=semanticRoles.map(role=>'<option value="'+role+'">'+label(role)+'</option>').join('');
 return '<details class="text-more" data-semantic-tools><summary>'+label('Library')+'</summary><div>'+
  field('Role','<select data-semantic-role><option value="">'+label('Unassigned')+'</option>'+roles+'</select>')+
  '<button type="button" data-semantic-apply>'+label('Apply')+'</button>'+
  '<details><summary>'+label('Appearance')+'</summary><div>'+
  field('Target','<select data-semantic-surface>'+['default','reading','website','pdf'].map(surface=>'<option value="'+surface+'">'+label(surface)+'</option>').join('')+'</select>')+
  field('Size','<input type="number" min="8" max="96" step="1" data-semantic-size>')+
  field('Weight','<select data-semantic-weight><option value="">'+label('Inherit')+'</option>'+[400,500,600,700].map(weight=>'<option>'+weight+'</option>').join('')+'</select>')+
  field('Color','<input type="text" placeholder="#183f41" maxlength="7" pattern="#[0-9a-fA-F]{6}" data-semantic-color>')+
  field('Italic','<select data-semantic-italic><option value="">'+label('Inherit')+'</option><option value="true">'+label('Italic')+'</option><option value="false">'+label('Upright')+'</option></select>')+
  '<button type="button" data-semantic-save>'+label('Update')+'</button></div></details>'+
  '<p role="status" data-semantic-status data-exception="'+label('Exception')+'" data-inherited="'+label('Inherited')+'"></p><button type="button" data-semantic-clear>'+label('Clear')+'</button></div></details>';
}
