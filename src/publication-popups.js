import {enhancePublicPopups} from './web/public-popups.js';
export {popupMarkup,copyTextMarkup} from './web/website-popup-markup.js';
export const PUBLIC_POPUPS_SCRIPT='('+enhancePublicPopups.toString()+')(document);\n';
