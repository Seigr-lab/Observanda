import {language,t} from '../i18n/index.js';

// Access-screen entry points share the same reader as Preferences.
export function accessHelpButton(esc,section='unlock'){
 return `<button type="button" class="button" data-action="access-help" data-section="${section}" lang="${language()}">${esc(t('help','title'))}</button>`;
}
