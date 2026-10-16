import {t} from './i18n/index.js';

// Presentation-only controls. Copy values are opaque text, never payment credentials.
export function websitePopupFields(section,esc){
 const tr=key=>esc(t('websiteEditor',key)),input=(key,label,multiline=false)=>'<label>'+tr(label)+(multiline?'<textarea rows="3"':'<input type="text"')+' data-home-section="'+section.id+'" data-key="'+key+'"'+(multiline?'>'+esc(section[key])+'</textarea>':' value="'+esc(section[key])+'">')+'</label>';
 return section.kind==='popup'
  ?input('label','popupLabel')+'<label>'+tr('popupWidth')+'<input type="number" min="1" step="1" data-home-section="'+section.id+'" data-key="dialogWidth" value="'+section.dialogWidth+'"></label><p class="muted">'+tr('popupHelp')+'</p>'
  :input('body','copyDescription',true)+input('value','copyValue',true)+input('label','copyLabel')+'<p class="muted">'+tr('copyHelp')+'</p>';
}
