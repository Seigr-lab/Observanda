import {t} from './i18n/index.js';

export function websiteDisclosureFields(section,esc){
 return '<label class="checkbox"><input type="checkbox" data-home-section="'+section.id+'" data-key="open" '+(section.open?'checked':'')+'><span>'+esc(t('websiteEditor','disclosureOpen'))+'</span></label><p class="muted">'+esc(t('websiteEditor','disclosureHelp'))+'</p>';
}
