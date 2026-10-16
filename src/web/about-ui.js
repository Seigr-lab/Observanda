import {OBSERVANDA_REPOSITORY} from './product-links.js';
import {t,messageLanguage} from './i18n/index.js';

export function repositoryLink(esc){return `<a href="${OBSERVANDA_REPOSITORY}" target="_blank" rel="noopener noreferrer" lang="${messageLanguage('about')}">${esc(t('about','repository'))}</a>`;}
export function aboutView(esc){return `<section class="panel" lang="${messageLanguage('about')}"><h2>${esc(t('about','title'))}</h2><p>${esc(t('about','description'))}</p><p>${repositoryLink(esc)}</p></section>`;}
