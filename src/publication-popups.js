import {actionClasses} from './web/website-action-style.js';
import {enhancePublicPopups} from './web/public-popups.js';
import {publicationText} from './web/publication-messages.js';

export const PUBLIC_POPUPS_SCRIPT='('+enhancePublicPopups.toString()+')(document);\n';
export function popupMarkup(section,{esc,id,children,editing}){
 const title=section.title||section.label||publicationText('popupOpen');
 const label=section.close?.label||publicationText('popupClose'),content=section.close?.content??'icon',close='<div class="popup-controls"'+(editing?'':' hidden')+'><button type="button" class="'+actionClasses(section,true)+'" aria-label="'+esc(label)+'">'+(content!=='text'?'<span aria-hidden="true" data-close-icon>×</span>':'')+(content!=='icon'?'<span>'+esc(label)+'</span>':'')+'</button></div>';
 return '<details class="section-popup-content" data-public-popup'+(editing?' open':'')+'><summary class="'+actionClasses(section)+'">'+esc(section.label||title)+'</summary><div class="popup-body">'+close+'<h2 id="'+id+'-title">'+esc(title)+'</h2><div class="container-content container-column">'+children+'</div></div></details>';
}
export function copyTextMarkup(section,esc,{editing=false}={}){
 const title=section.title||publicationText('copyValue');
 return '<div class="public-copy" data-copy-value="'+esc(JSON.stringify(section.value))+'" data-copied="'+esc(publicationText('copySuccess'))+'" data-fallback="'+esc(publicationText('copyFallback'))+'">'+(section.body?'<p class="prose">'+esc(section.body)+'</p>':'')+'<textarea readonly rows="2" spellcheck="false" aria-label="'+esc(title)+'">'+esc(section.value)+'</textarea><button type="button" class="'+actionClasses(section)+'"'+(editing?'':' hidden')+'>'+esc(section.label||publicationText('copyAction'))+'</button><p class="copy-status" role="status" aria-live="polite"></p></div>';
}
